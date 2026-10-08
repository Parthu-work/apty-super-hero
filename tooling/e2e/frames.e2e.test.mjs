/**
 * DOM Health frame handling in a real browser: frames from two origins, a
 * data: frame, a legacy frameset, open and closed shadow roots.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  launchBrowser,
  extensionPage as openExtensionPage,
  startPageServer,
} from "./harness.mjs";

const SHADOW_PAGE = `<!doctype html><body>
  <h1>Top</h1>
  <div id="open-host"></div><div id="closed-host"></div>
  <iframe id="same" src="/child.html"></iframe>
  <iframe id="cross" src="{other}/child.html"></iframe>
  <iframe id="data" src="data:text/html,<button>in data frame</button>"></iframe>
  <script>
    document.getElementById("open-host").attachShadow({ mode: "open" }).innerHTML = "<button>open</button>";
    document.getElementById("closed-host").attachShadow({ mode: "closed" }).innerHTML = "<button>closed</button>";
  </script>
</body>`;
const CHILD_PAGE = `<!doctype html><body><button>child</button><input></body>`;
const FRAMESET_PAGE = `<!doctype html><html><frameset cols="50%,50%">
  <frame src="/child.html"><frame src="{other}/child.html">
</frameset></html>`;

let browser;
let serverA;
let serverB;

before(async () => {
  // Each server's pages point their cross-origin frames at the other one.
  const pagesFor = (other) => ({
    "/top.html": () => SHADOW_PAGE.replaceAll("{other}", other()),
    "/child.html": CHILD_PAGE,
    "/frameset.html": () => FRAMESET_PAGE.replaceAll("{other}", other()),
  });
  serverA = await startPageServer(
    pagesFor(() => `http://localhost:${serverB.address().port}`),
  );
  serverB = await startPageServer(pagesFor(() => serverA.origin));
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  serverA?.close();
  serverB?.close();
});

async function openPage(path) {
  const page = await browser.context.newPage();
  await page.goto(`${serverA.origin}${path}`);
  await page.waitForLoadState("load");
  return page;
}

function extensionPage() {
  return openExtensionPage(browser);
}

/** Ask every frame of the tab showing `urlPattern` for `message`, by frameId. */
async function askEveryFrame(urlPattern, message) {
  const ext = await extensionPage();
  try {
    return await ext.evaluate(
      async ({ urlPattern, message }) => {
        const [tab] = await chrome.tabs.query({ url: urlPattern });
        const frames = await chrome.webNavigation.getAllFrames({
          tabId: tab.id,
        });
        return Promise.all(
          frames.map(async (frame) => {
            try {
              const response = await chrome.tabs.sendMessage(tab.id, message, {
                frameId: frame.frameId,
              });
              return { url: frame.url, frameId: frame.frameId, response };
            } catch (error) {
              return {
                url: frame.url,
                frameId: frame.frameId,
                error: String(error),
              };
            }
          }),
        );
      },
      { urlPattern, message },
    );
  } finally {
    await ext.close();
  }
}

describe("built extension in Chromium", () => {
  it("answers DOM Health in every frame: same-origin, cross-origin and data:", async () => {
    const page = await openPage("/top.html");
    await page.waitForTimeout(500);

    const results = await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "dom-health-ping",
    });

    assert.equal(results.length, 4, JSON.stringify(results));
    for (const result of results) {
      assert.deepEqual(
        result.response,
        { success: true, data: { pong: true } },
        JSON.stringify(result),
      );
    }
    await page.close();
  });

  it("answers in both frames of a legacy frameset", async () => {
    const page = await openPage("/frameset.html");
    await page.waitForTimeout(500);

    const results = await askEveryFrame("http://127.0.0.1/*frameset.html", {
      request: "collect-dom-health-frame-bundle",
      sequenceIndex: 0,
    });
    const children = results.filter((r) => r.url.endsWith("/child.html"));

    assert.equal(children.length, 2);
    for (const child of children) {
      assert.equal(child.response?.success, true, JSON.stringify(child));
      assert.equal(child.response.data.snapshot.counts.buttons, 1);
    }
    await page.close();
  });

  it("counts open and closed shadow roots in a real page", async () => {
    const page = await openPage("/top.html");

    const [top] = await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "collect-dom-health-frame-bundle",
      sequenceIndex: 0,
    }).then((rs) => rs.filter((r) => r.frameId === 0));

    assert.equal(top.response?.success, true, JSON.stringify(top));
    assert.equal(top.response.data.snapshot.shadowDom.roots, 2);
    await page.close();
  });

  it("mounts the UI in the top frame only", async () => {
    const page = await openPage("/top.html");
    await page.waitForTimeout(1000);

    const mounted = await Promise.all(
      page
        .frames()
        .map((frame) =>
          frame
            .evaluate(() =>
              Boolean(document.getElementById("aipex-content-root")),
            )
            .catch(() => "unreachable"),
        ),
    );

    assert.equal(mounted[0], true);
    assert.ok(
      mounted.slice(1).every((m) => m === false || m === "unreachable"),
      JSON.stringify(mounted),
    );
    await page.close();
  });

  it("can re-inject the responder into a frame, which then still answers once", async () => {
    const page = await openPage("/top.html");
    const ext = await extensionPage();

    const response = await ext.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        url: "http://127.0.0.1/*top.html",
      });
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      const cross = frames.find((f) => f.url.includes("localhost"));
      const file = chrome.runtime
        .getManifest()
        .content_scripts.flatMap((s) => s.js)
        .find((js) => js.includes("frame-responder"));
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [cross.frameId] },
        files: [file],
      });
      return chrome.tabs.sendMessage(
        tab.id,
        { request: "dom-health-ping" },
        { frameId: cross.frameId },
      );
    });

    assert.deepEqual(response, { success: true, data: { pong: true } });
    await ext.close();
    await page.close();
  });
});
