/**
 * DOM Config's collector and behavior probe in a real browser (R2): each
 * frame profiled by its own responder, cross-origin frames included, the
 * console script's JSON shape, noise left out, and mutation bursts counted
 * without Apty's own changes.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  launchBrowser,
  extensionPage as openExtensionPage,
  startPageServer,
} from "./harness.mjs";

/** The DOM analysis console script SEs run (DOM Config brief, Appendix A), returning its result. */
const DOM_ANALYSIS_SCRIPT = `(() => {
  var makeSafe = function (fn) { return function () { try { return fn.apply(this, arguments); } catch (e) {} }; };
  var getAllElements = makeSafe((root) => root.querySelectorAll("*"));
  var crossOriginCount = 1;
  var getIFrameOrigin = (element) => { var origin = ""; try { origin = element.contentWindow && element.contentWindow.location.href; } catch (e) { origin = "Cross Origin " + crossOriginCount + " (src: " + element.src + ")"; crossOriginCount++; } return origin; };
  var isCrossOriginFrame = makeSafe((element) => { var isCrossOrigin = false; try { var origin = element.contentWindow && element.contentWindow.location.origin; isCrossOrigin = window.top.location.origin !== origin; } catch (e) { isCrossOrigin = true; } return isCrossOrigin; });
  var findIFrame = makeSafe((tag, element, out) => { if (tag === "iframe") { var origin = getIFrameOrigin(element); if (!out.iframes) out.iframes = {}; if (!out.iframes[origin]) { out.iframes[origin] = { isCrossOrigin: isCrossOriginFrame(element) }; var frameElements = getAllElements(element.contentDocument && element.contentDocument); if (frameElements && frameElements.length) startDomAnalysis(frameElements, out.iframes[origin]); } } });
  var findAttributes = makeSafe((element, out) => { for (var j = 0; j < (element.attributes || []).length; j++) { var a = element.attributes[j]; if (!out.attributes) out.attributes = {}; if (!out.attributes[a.name]) out.attributes[a.name] = {}; if (!out.attributes[a.name][a.value]) out.attributes[a.name][a.value] = 0; out.attributes[a.name][a.value]++; } });
  var findShadowRoots = makeSafe((tag, element, out) => { if (element && element.shadowRoot instanceof DocumentFragment) { if (!out.shadowRoots) out.shadowRoots = {}; if (!out.shadowRoots[tag]) { out.shadowRoots[tag] = {}; var els = getAllElements(element.shadowRoot); if (els && els.length) startDomAnalysis(els, out.shadowRoots[tag]); } } });
  var findMaxZIndex = makeSafe((element, out) => { var styles = window.getComputedStyle(element); var zIndex = +(styles && styles.zIndex) || 0; if (zIndex) { if (!out.maxZIndex) out.maxZIndex = 0; if (zIndex > out.maxZIndex) out.maxZIndex = zIndex; } });
  var startDomAnalysis = makeSafe((elements, out) => { if (!out) out = {}; for (var i = 0; i < (elements || []).length; i++) { var element = elements[i]; if (!element) continue; var tag = (element.tagName || "").toLowerCase(); if (!out.tags) out.tags = {}; if (!out.tags[tag]) out.tags[tag] = 0; out.tags[tag]++; findAttributes(element, out); findMaxZIndex(element, out); findIFrame(tag, element, out); findShadowRoots(tag, element, out); } return out; });
  return startDomAnalysis(getAllElements(document));
})()`;

const ROWS = Array.from(
  { length: 520 },
  (_, i) =>
    `<div class="row RptTable" data-row="r${i}"><span class="cell">${i}</span><input name="f${i % 20}" placeholder="Value"><b></b></div>`,
).join("");

const TOP_PAGE = `<!doctype html><html lang="en"><head><title>Chart</title></head><body>
  <main id="app" data-ref="grid">${ROWS}</main>
  <x-card id="card"></x-card>
  <img id="pm-icon" alt="" style="position: fixed; z-index: 999999; top: 0; left: 0">
  <apty-widget><div class="tip" data-step="1">Apty tip</div></apty-widget>
  <div id="toast" style="position: fixed; z-index: 9999"></div>
  <iframe id="same" src="/child.html"></iframe>
  <iframe id="cross" src="{other}/child.html?doc=884213"></iframe>
  <script>
    document.getElementById("card").attachShadow({ mode: "open" }).innerHTML =
      '<header class="title">Card</header><button id="ui-id-1">Open</button>';
    window.runBursts = () => {
      const app = document.getElementById("app");
      const tip = document.querySelector("apty-widget .tip");
      const step = (n) => {
        app.setAttribute("data-step", String(n));
        tip.setAttribute("data-step", String(n));
        setTimeout(() => app.append(document.createElement("p")), 20);
        setTimeout(() => (n < 3 ? step(n + 1) : (tip.dataset.done = "yes")), 400);
      };
      step(1);
      setInterval(() => tip.setAttribute("data-tick", String(Date.now())), 150);
    };
  </script>
</body></html>`;

const CHILD_PAGE = `<!doctype html><html><head></head><body>
  <form id="notes"><textarea name="note" placeholder="Note"></textarea><button type="submit">Save</button></form>
</body></html>`;

const LARGE_PAGE = `<!doctype html><html><body>${Array.from(
  { length: 2_500 },
  (_, i) =>
    `<div class="r" data-i="${i % 50}"><span></span><i></i><b></b></div>`,
).join("")}</body></html>`;

const TICKER_PAGE = `<!doctype html><html><body>
  <header><span id="clock" class="clock">12:00:00</span></header>
  <div id="toolbar"><button>Save</button></div>
  <main id="app"><p>Static</p></main>
  <script>
    window.startTicking = () => {
      let n = 0;
      setInterval(() => {
        n++;
        const clock = document.getElementById("clock");
        clock.textContent = "12:00:" + String(n).padStart(2, "0");
        document.getElementById("toolbar").setAttribute("data-tick", String(n));
      }, 200);
    };
  </script>
</body></html>`;

let browser;
let serverA;
let serverB;

before(async () => {
  const pagesFor = (other) => ({
    "/top.html": () => TOP_PAGE.replaceAll("{other}", other()),
    "/child.html": CHILD_PAGE,
    "/large.html": LARGE_PAGE,
    "/ticker.html": TICKER_PAGE,
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

/** Send `message` to every frame of the tab showing `urlPattern`, by frameId. */
async function askEveryFrame(urlPattern, message) {
  const ext = await openExtensionPage(browser);
  try {
    return await ext.evaluate(
      async ({ urlPattern, message }) => {
        const [tab] = await chrome.tabs.query({ url: urlPattern });
        const frames = await chrome.webNavigation.getAllFrames({
          tabId: tab.id,
        });
        return Promise.all(
          frames.map(async (frame) => ({
            url: frame.url,
            frameId: frame.frameId,
            response: await chrome.tabs
              .sendMessage(tab.id, message, { frameId: frame.frameId })
              .catch((error) => ({ success: false, error: String(error) })),
          })),
        );
      },
      { urlPattern, message },
    );
  } finally {
    await ext.close();
  }
}

describe("DOM Config collector in Chromium", () => {
  it("profiles every frame by its own responder, cross-origin included, in the script's shape", async () => {
    const page = await openPage("/top.html");

    const results = await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "collect-dom-profile",
      ignoredRoots: [],
    });

    assert.equal(results.length, 3, JSON.stringify(results.map((r) => r.url)));
    for (const result of results) {
      assert.equal(result.response.success, true, JSON.stringify(result));
    }
    const top = results.find((r) => r.frameId === 0).response.data;
    assert.equal(top.schema, 2);
    assert.ok(top.meta.elementCount > 2_000, String(top.meta.elementCount));
    assert.equal(top.tags.div, 521);
    assert.equal(top.tags["apty-widget"], undefined);
    assert.equal(top.attributes["data-step"], undefined);
    assert.deepEqual(top.shadowRoots["x-card"].attributes.id, { "ui-id-1": 1 });
    assert.deepEqual(top.shadow, [{ hostTag: "x-card", mode: "open" }]);
    assert.deepEqual(
      top.zIndexSources.map((s) => [s.value, s.tag, s.inline]),
      [
        [999999, "img", true],
        [9999, "div", true],
      ],
    );
    assert.equal(top.meta.aptyPresent, true);
    assert.equal(top.meta.extensionNoisePresent, true);
    assert.equal(top.meta.partial, false);
    assert.deepEqual(top.meta.truncatedAttributes, []);
    assert.equal(top.meta.cutValues, 0);
    assert.equal(top.meta.closedShadowRootsVisible, true);
    assert.deepEqual(
      top.frames.map((f) => [
        f.src,
        f.readable,
        f.reason ?? null,
        f.crossOrigin,
      ]),
      [
        ["/child.html", true, null, false],
        [
          `http://localhost:${serverB.address().port}/child.html?doc`,
          false,
          "blocked-cross-origin",
          true,
        ],
      ],
    );

    const cross = results.find((r) => r.url.startsWith("http://localhost"))
      .response.data;
    assert.deepEqual(cross.attributes.name, { note: 1 });
    assert.equal(
      cross.meta.urlShape,
      `http://localhost:${serverB.address().port}/child.html?doc`,
    );
    await page.close();
  });

  it("matches the console script exactly on a frame without noise (acceptance criterion 1)", async () => {
    const page = await openPage("/top.html");
    const childFrame = page
      .frames()
      .find((f) => f.url().endsWith("/child.html"));
    const script = await childFrame.evaluate(DOM_ANALYSIS_SCRIPT);

    const results = await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "collect-dom-profile",
    });
    const child = results.find((r) => r.url === `${serverA.origin}/child.html`);
    const { tags, attributes, maxZIndex, shadowRoots } = child.response.data;

    assert.deepEqual(
      JSON.parse(JSON.stringify({ tags, attributes, maxZIndex, shadowRoots })),
      JSON.parse(JSON.stringify(script)),
    );
    await page.close();
  });

  it("counts mutation bursts with Apty's own changes left out", async () => {
    const page = await openPage("/top.html");
    const [armed] = await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "dom-config-probe-arm",
      windowMs: 3000,
    }).then((rs) => rs.filter((r) => r.frameId === 0));
    assert.equal(armed.response.success, true, JSON.stringify(armed));

    await page.evaluate(() => window.runBursts());
    await page.waitForFunction(
      () => document.querySelector("apty-widget .tip").dataset.done === "yes",
    );
    const [captured] = await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "dom-config-probe-capture",
    }).then((rs) => rs.filter((r) => r.frameId === 0));
    await askEveryFrame("http://127.0.0.1/*top.html", {
      request: "dom-config-probe-disarm",
    });

    const probe = captured.response.data;
    assert.equal(probe.ran, true);
    assert.equal(probe.mutationBursts.length, 3, JSON.stringify(probe));
    for (const burst of probe.mutationBursts) {
      assert.equal(burst.mutationCount, 2, JSON.stringify(probe));
    }
    assert.equal(probe.burstGapsMs.length, 2);
    assert.deepEqual(probe.eventRates, {});
    await page.close();
  });

  it("names the elements that keep changing, for Ignore DOM events", async () => {
    const page = await openPage("/ticker.html");
    const [armed] = await askEveryFrame("http://127.0.0.1/*ticker.html", {
      request: "dom-config-probe-arm",
      windowMs: 2000,
    });
    assert.equal(armed.response.success, true, JSON.stringify(armed));

    await page.evaluate(() => window.startTicking());
    await page.waitForTimeout(2100);
    const [captured] = await askEveryFrame("http://127.0.0.1/*ticker.html", {
      request: "dom-config-probe-capture",
    });
    await askEveryFrame("http://127.0.0.1/*ticker.html", {
      request: "dom-config-probe-disarm",
    });

    const sources = captured.response.data.mutationSources;
    const clock = sources.find((s) => s.id === "clock");
    assert.ok(clock && clock.callbacks >= 5, JSON.stringify(sources));
    assert.deepEqual(
      {
        tag: clock.tag,
        classes: clock.classes,
        interactive: clock.interactive,
      },
      { tag: "span", classes: ["clock"], interactive: 0 },
    );
    const toolbar = sources.find((s) => s.id === "toolbar");
    assert.deepEqual(toolbar?.attributeNames, ["data-tick"]);
    assert.ok(toolbar.interactive >= 1, JSON.stringify(toolbar));
    assert.equal(
      sources.some((s) => s.id === "app"),
      false,
      JSON.stringify(sources),
    );
    await page.close();
  });

  it("profiles 10,000 elements within the collector's budget", async () => {
    const page = await openPage("/large.html");

    const [top] = await askEveryFrame("http://127.0.0.1/*large.html", {
      request: "collect-dom-profile",
    });

    const profile = top.response.data;
    assert.ok(
      profile.meta.elementCount >= 10_003,
      String(profile.meta.elementCount),
    );
    assert.equal(profile.meta.partial, false);
    assert.ok(profile.meta.durationMs < 6_000, String(profile.meta.durationMs));
    assert.deepEqual(Object.keys(profile.attributes["data-i"]).length, 50);
    await page.close();
  });
});
