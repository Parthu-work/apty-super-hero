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

let browser;
let site;

before(async () => {
  site = await startPageServer({ "/spa.html": SPA_PAGE });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  site?.close();
});

/** Send `message` to frame 0 of the tab showing spa.html, from an extension page. */
async function askTopFrame(ext, message) {
  return ext.evaluate(async (message) => {
    const [tab] = await chrome.tabs.query({
      url: "http://127.0.0.1/*spa.html*",
    });
    return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  }, message);
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
});
