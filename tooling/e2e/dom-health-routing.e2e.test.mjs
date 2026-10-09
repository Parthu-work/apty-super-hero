/**
 * DOM Health routing evidence in a real browser: the page's own
 * history.pushState calls, including those made while the page loads
 * (counted by the MAIN-world hooks, not the isolated world), and the
 * developer route probe recording a real user click in a pushState
 * application that renders its screen inside a shadow root.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { extensionPage, launchBrowser, startPageServer } from "./harness.mjs";

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

before(async () => {
  site = await startPageServer({
    "/spa.html": SPA_PAGE,
    "/late.html": LATE_SHADOW_PAGE,
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  site?.close();
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
