/**
 * Real-browser tests for the built extension: loads apps/browser-extension/dist
 * into Chromium as an unpacked MV3 extension and drives real pages served
 * from two origins. Run `npm run build` first, then `npm run test:e2e`.
 *
 * Chromium path: E2E_CHROMIUM_PATH, else the preinstalled Playwright build,
 * else Puppeteer's Chrome for Testing (what CI installs). Branded Chrome
 * ignores --load-extension, so it cannot be used here.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSION_DIR = join(ROOT, "apps/browser-extension/dist");

function chromiumPath() {
  if (process.env.E2E_CHROMIUM_PATH) return process.env.E2E_CHROMIUM_PATH;
  if (existsSync("/opt/pw-browsers/chromium"))
    return "/opt/pw-browsers/chromium";
  const require = createRequire(
    join(ROOT, "packages/browser-runtime/package.json"),
  );
  return require("puppeteer").executablePath();
}

/** Serves `pages` (path -> html) on a random loopback port; `{other}` is replaced with the other server's origin. */
function startServer(pages) {
  const server = createServer((req, res) => {
    const html = pages[req.url ?? "/"];
    if (!html) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html.replaceAll("{other}", server.otherOrigin ?? ""));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

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

let context;
let extensionId;
let serverA;
let serverB;
let userDataDir;

before(async () => {
  assert.ok(
    existsSync(join(EXTENSION_DIR, "manifest.json")),
    "Build the extension first (npm run build).",
  );
  const pages = {
    "/top.html": SHADOW_PAGE,
    "/child.html": CHILD_PAGE,
    "/frameset.html": FRAMESET_PAGE,
  };
  serverA = await startServer(pages);
  serverB = await startServer(pages);
  serverA.otherOrigin = `http://localhost:${serverB.address().port}`;
  serverB.otherOrigin = `http://127.0.0.1:${serverA.address().port}`;

  userDataDir = mkdtempSync(join(tmpdir(), "apty-e2e-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromiumPath(),
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  extensionId = new URL(worker.url()).host;
});

after(async () => {
  await context?.close();
  serverA?.close();
  serverB?.close();
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
});

async function openPage(path) {
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${serverA.address().port}${path}`);
  await page.waitForLoadState("load");
  return page;
}

/** An extension page to call chrome.* APIs from, like the side panel does. */
async function extensionPage() {
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/src/entrypoints/options/index.html`,
  );
  return page;
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
