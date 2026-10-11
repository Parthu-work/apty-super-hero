/**
 * DOM Health routing evidence in a real browser: the page's own
 * history.pushState calls, including those made while the page loads
 * (counted by the MAIN-world hooks, not the isolated world), and the
 * developer route probe recording a real user click in a pushState
 * application that renders its screen inside a shadow root.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  callToolThenReport,
  chatAndWait,
  extensionPage,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

const SPA_PAGE = `<!doctype html><title>Orders</title><body>
  <nav><a href="#" id="orders" aria-current="page">Orders</a><button id="customers">Customers</button></nav>
  <div id="app-root"></div>
  <script>
    const root = document.getElementById("app-root").attachShadow({ mode: "open" });
    root.innerHTML = "<h1>Orders</h1>";
    history.pushState({ screen: "orders" }, "", "/spa.html?screen=orders");
    history.replaceState({ screen: "orders" }, "", "/spa.html?screen=orders");
    document.getElementById("customers").addEventListener("click", () => {
      fetch("/api/4242424/customers?q=123456").catch(() => {});
      history.pushState({ screen: "customers" }, "", "/spa.html?screen=customers");
      root.innerHTML = "<h1>Customers</h1>";
    });
  </script>
</body>`;

/** A host whose shadow root is attached later, then filled over ~700 ms, ending with a control (Infor IDS and athenaOne mount this way). */
const LATE_SHADOW_PAGE = `<!doctype html><title>Late</title><body>
  <div id="late-host"></div>
  <script>
    window.lateMount = () => {
      const root = document.getElementById("late-host").attachShadow({ mode: "open" });
      let ticks = 0;
      const timer = setInterval(() => {
        root.append(document.createElement("span"));
        if (++ticks === 7) {
          clearInterval(timer);
          const save = document.createElement("button");
          save.textContent = "Save";
          root.append(save);
        }
      }, 100);
    };
  </script>
</body>`;

let browser;
let site;
let model;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/spa.html": SPA_PAGE,
    "/late.html": LATE_SHADOW_PAGE,
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  site?.close();
  model?.close();
});

/** Send `message` to frame 0 of the tab showing `page`, from an extension page. */
async function askTopFrame(ext, message, page = "spa.html") {
  return ext.evaluate(
    async ({ message, page }) => {
      const [tab] = await chrome.tabs.query({
        url: `http://127.0.0.1/*${page}*`,
      });
      return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
    },
    { message, page },
  );
}

describe("DOM Health routing evidence", () => {
  it("counts the page's own pushState calls, made from page script while it loads", async () => {
    const page = await browser.context.newPage();
    await page.goto(`${site.origin}/spa.html`);
    await page.waitForLoadState("load");
    const ext = await extensionPage(browser);

    const model = await askTopFrame(ext, {
      request: "get-dom-health-navigation-model",
    });

    assert.equal(model.success, true, JSON.stringify(model));
    assert.equal(model.data.usesHistoryApiRouting, true);
    assert.equal(model.data.historyApiCallCount, 2);
    assert.equal(model.data.pushStateCount, 1);
    await ext.close();
    await page.close();
  });

  it("records a user click with the probe: new heading in a shadow root, the first request path, pushState", async () => {
    const page = await browser.context.newPage();
    await page.goto(`${site.origin}/spa.html`);
    await page.waitForLoadState("load");
    const ext = await extensionPage(browser);
    await ext.evaluate(() => {
      window.__probeClicks = [];
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.request === "dom-health-probe-click") {
          window.__probeClicks.push(message.label);
        }
      });
    });

    const before = await askTopFrame(ext, {
      request: "dom-health-probe-capture",
    });
    await askTopFrame(ext, { request: "dom-health-probe-arm" });
    await page.bringToFront();
    await page.click("#customers");
    await page.waitForTimeout(500);
    const afterClick = await askTopFrame(ext, {
      request: "dom-health-probe-capture",
    });
    const clicks = await ext.evaluate(() => window.__probeClicks);
    await askTopFrame(ext, { request: "dom-health-probe-disarm" });

    assert.equal(before.data.firstHeading, "Orders");
    assert.equal(before.data.activeNavItem, "Orders");
    assert.equal(afterClick.data.firstHeading, "Customers");
    assert.equal(
      afterClick.data.pushStateCount - before.data.pushStateCount,
      1,
    );
    assert.equal(afterClick.data.firstRequest?.path, "/api/4242424/customers");
    assert.equal(afterClick.data.firstRequest?.initiatorType, "fetch");
    assert.deepEqual(clicks, ["Customers"]);
    await ext.close();
    await page.close();
  });
  it("waits for a shadow root attached after the wait began, and captures its control", async () => {
    const page = await browser.context.newPage();
    await page.goto(`${site.origin}/late.html`);
    await page.waitForLoadState("load");
    const ext = await extensionPage(browser);

    const waiting = askTopFrame(
      ext,
      { request: "wait-for-dom-stable", quietMs: 300, timeoutMs: 5000 },
      "late.html",
    );
    await page.evaluate(() => setTimeout(() => window.lateMount(), 200));
    const wait = await waiting;
    const bundle = await askTopFrame(
      ext,
      { request: "collect-dom-health-frame-bundle", sequenceIndex: 0 },
      "late.html",
    );

    assert.equal(wait.success, true, JSON.stringify(wait));
    assert.ok(
      wait.data.elapsedMs >= 900,
      `settled after ${wait.data.elapsedMs} ms`,
    );
    assert.deepEqual(
      bundle.data.snapshot.elementReports.map((r) => [
        r.tagName,
        r.shadowDepth,
      ]),
      [["button", 1]],
    );
    await ext.close();
    await page.close();
  });
});

/** Merge `patch` into the stored settings from an extension page, then wait for the bridge registration to match `excluded`. */
async function setPageHookSettings(ext, patch, expectExcluded) {
  await ext.evaluate(async (patch) => {
    const { aipex_settings } = await chrome.storage.local.get("aipex_settings");
    await chrome.storage.local.set({
      aipex_settings: { ...aipex_settings, ...patch },
    });
  }, patch);
  const deadline = Date.now() + 10_000;
  for (;;) {
    const excludes = await ext.evaluate(async () => {
      const [script] = await chrome.scripting.getRegisteredContentScripts({
        ids: ["apty-console-bridge"],
      });
      return script?.excludeMatches ?? [];
    });
    if (excludes.includes("*://127.0.0.1/*") === expectExcluded) return;
    if (Date.now() > deadline)
      throw new Error(`registration still ${excludes}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Open spa.html, counting the hooks' history events from before any page script runs. */
async function openSpaCountingHookEvents() {
  const page = await browser.context.newPage();
  await page.addInitScript(() => {
    window.__hookEvents = 0;
    addEventListener("apty:dom-health:history-api", () => {
      window.__hookEvents++;
    });
  });
  await page.goto(`${site.origin}/spa.html`);
  return page;
}

describe("page-world script switch (B5)", () => {
  it("registers the console bridge dynamically, in the page world, for every frame", async () => {
    const ext = await extensionPage(browser);
    const [script] = await ext.evaluate(() =>
      chrome.scripting.getRegisteredContentScripts({
        ids: ["apty-console-bridge"],
      }),
    );
    assert.equal(script.world, "MAIN");
    assert.equal(script.runAt, "document_start");
    assert.equal(script.allFrames, true);
    assert.deepEqual(script.js, ["content/console-bridge.js"]);
    await ext.close();
  });

  it("on an excluded site: native pushState, no hook events, and routing evidence unavailable with a reason", async () => {
    const ext = await extensionPage(browser);
    await setPageHookSettings(
      ext,
      { pageHooksExcludedSites: ["127.0.0.1"] },
      true,
    );

    const page = await openSpaCountingHookEvents();
    assert.match(
      await page.evaluate(() => history.pushState.toString()),
      /\[native code\]/,
    );
    assert.equal(await page.evaluate(() => window.__hookEvents), 0);
    assert.equal(
      await page.evaluate(() => typeof window.__aptyReadConsoleBuffer),
      "undefined",
    );
    const frameModel = await askTopFrame(ext, {
      request: "get-dom-health-navigation-model",
    });
    assert.equal(frameModel.data.historyHooksSeen, false);

    const panel = await openSidePanel(browser, model, page);
    model.script(
      callToolThenReport("run_application_dom_health_audit", { maxPages: 2 }),
    );
    await chatAndWait(panel, "check dom health across the whole application", {
      timeout: 150_000,
    });
    const result = toolResults(model.requests.at(-1)).at(-1);
    const navigation = result.pages[0].navigationModel;
    assert.equal(
      navigation.routingEvidence,
      "unavailable",
      JSON.stringify(navigation),
    );
    assert.match(
      navigation.routingEvidenceReason,
      /Settings → Troubleshooting/,
    );
    await panel.close();
    await page.close();

    // openSidePanel rewrote the settings; exclude again, then lift it.
    await setPageHookSettings(
      ext,
      { pageHooksExcludedSites: ["127.0.0.1"] },
      true,
    );
    await setPageHookSettings(ext, { pageHooksExcludedSites: [] }, false);
    const hooked = await openSpaCountingHookEvents();
    assert.doesNotMatch(
      await hooked.evaluate(() => history.pushState.toString()),
      /\[native code\]/,
    );
    assert.ok((await hooked.evaluate(() => window.__hookEvents)) > 0);
    await hooked.close();
    await ext.close();
  });
});
