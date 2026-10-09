/**
 * DOM Health end to end on the application shapes the brief names (section
 * WP-9): a deep shadow-DOM application, a legacy frameset, a cross-origin
 * app-in-iframe portal, a pushState SPA, a click-only application and an
 * application carrying a third-party overlay. Each runs the real audit
 * through the real side panel and agent loop, with a scripted model, in
 * Chromium. The pages are small stand-ins of those shapes, built from the
 * values measured in the Infor LN and athenaOne exports; they are not the
 * real applications.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  callToolThenReport,
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

/** Shadow roots nested three deep (the LN export's measured nesting), the controls in the innermost one. */
const DEEP_SHADOW_PAGE = `<!doctype html><title>Deep</title><body><main id="m"></main><script>
  let parent = document.getElementById("m");
  for (let depth = 0; depth < 3; depth++) {
    const host = document.createElement("ids-layer");
    parent.append(host);
    parent = host.attachShadow({ mode: "open" });
  }
  parent.innerHTML = '<h1>Sales Orders</h1><form><input name="order" aria-label="Order"><button type="button" id="find">Find</button></form>';
</script></body>`;

/** 251 shadow roots in the LN export's shape: nested up to 3 deep, a slot in each, a control slotted into every one. */
const LN_SIZED_PAGE = `<!doctype html><title>Portal</title><body><script>
  let made = 0;
  const mount = (parent, depth) => {
    const host = document.createElement("ids-panel");
    host.innerHTML = '<button class="ids-button" aria-label="Action ' + made + '">Action</button>';
    parent.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div part="container"><slot></slot></div>';
    made++;
    if (depth < 3 && made < 251) mount(root.firstElementChild, depth + 1);
  };
  while (made < 251) mount(document.body, 1);
</script></body>`;

/** athenaOne's frameset shape: frames identified by id, navigation and status around the application. */
const FRAMESET_PAGE = `<!doctype html><html><head><title>Frameset</title></head><frameset rows="20%,70%,10%">
  <frame id="GlobalNav" src="/nav.html"><frame id="GlobalWrapper" src="/registration.html"><frame id="Status" src="/status.html">
</frameset></html>`;
const NAV_PAGE = `<!doctype html><nav><a href="#" aria-current="page">Patients</a></nav>`;
const REGISTRATION_PAGE = `<!doctype html><main><h3>Contact Details</h3><form><input name="phone" aria-label="Phone"><select name="legalSex" aria-label="Legal sex"><option>-</option></select></form></main>`;
const STATUS_PAGE = `<!doctype html><div>Ready</div>`;

/** Infor OS Portal's shape: a portal shell with no form controls, the application in a cross-origin iframe keyed by data-osp-id. */
const PORTAL_PAGE = (lnOrigin) => `<!doctype html><title>Portal</title><body>
  <header><button aria-label="Menu">Menu</button></header>
  <div role="tablist"><div role="tab" aria-selected="true">LN</div></div>
  <div role="main"><iframe title="LN" name="LN_44_11111111-2222-4333-8444-555555555555" data-osp-id="LN"
    src="${lnOrigin}/ln.html?inforTenantId=FAKETENANT000000_TRN&amp;inforSessionId=FAKETENANT000000_TRN~00000000-0000-4000-8000-000000000000"></iframe></div>
</body>`;
const LN_PAGE = `<!doctype html><main><h1>Sales Orders</h1><form><input name="customer" aria-label="Customer"><button type="button">Search</button></form></main>`;

/** A pushState SPA whose links are real hrefs, rendered client-side, every route served by the same shell. */
const SPA_SHELL = `<!doctype html><title>SPA</title><body>
  <nav><a href="/spa/orders" data-route>Orders</a><a href="/spa/customers" data-route>Customers</a></nav>
  <main id="view"></main>
  <script>
    const render = () => {
      const screen = location.pathname.split("/").pop() || "orders";
      document.getElementById("view").innerHTML = "<h1>" + screen + "</h1><button>Open " + screen + "</button>";
    };
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[data-route]");
      if (!link) return;
      event.preventDefault();
      history.pushState({}, "", link.getAttribute("href"));
      render();
    });
    render();
  </script>
</body>`;

/** No links at all: the menu swaps the screen in place, the URL never changes. */
const CLICK_ONLY_PAGE = `<!doctype html><title>Click</title><body>
  <nav role="menu"><div role="menuitem" id="m-orders">Orders</div><div role="menuitem" id="m-items">Items</div></nav>
  <main id="view"><h1>Home</h1></main>
  <script>
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      item.addEventListener("click", () => {
        document.getElementById("view").innerHTML = "<h1>" + item.textContent + "</h1><button>Edit " + item.textContent + "</button>";
      });
    }
  </script>
</body>`;

/** athenaOne's Pendo badge (the measured id and class shapes) and a chat launcher over an ordinary form. */
const OVERLAY_PAGE = `<!doctype html><title>Overlay</title><body>
  <main><h1>Registration</h1><form><input name="email" aria-label="Email"><button type="button">Save</button></form></main>
  <button type="button" id="_pendo-badge_2kHDZJNfO4ClXH" class="_pendo-badge _pendo-badge_"><img id="pendo-image-badge-5762de01" class="_pendo-image" alt=""></button>
  <div id="intercom-container" style="position:fixed;bottom:0;right:0"><button>Chat</button></div>
</body>`;

let browser;
let model;
let site;
let other;

before(async () => {
  model = await startMockModel();
  other = await startPageServer({ "/ln.html": LN_PAGE });
  site = await startPageServer({
    "/deep.html": DEEP_SHADOW_PAGE,
    "/ln-sized.html": LN_SIZED_PAGE,
    "/frameset.html": FRAMESET_PAGE,
    "/nav.html": NAV_PAGE,
    "/registration.html": REGISTRATION_PAGE,
    "/status.html": STATUS_PAGE,
    "/portal.html": () =>
      PORTAL_PAGE(`http://localhost:${other.address().port}`),
    "/spa/orders": SPA_SHELL,
    "/spa/customers": SPA_SHELL,
    "/click.html": CLICK_ONLY_PAGE,
    "/overlay.html": OVERLAY_PAGE,
  });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
  other?.close();
});

/** Open `path`, run `tool` through the side panel, and return the tool result the model received. */
async function audit(path, tool, args = {}) {
  const page = await browser.context.newPage();
  await page.goto(`${site.origin}${path}`);
  await page.waitForLoadState("load");
  const panel = await openSidePanel(browser, model, page);
  model.script(callToolThenReport(tool, args));
  // The agent offers tools by relevance to the message, so ask the way a user would.
  const ask =
    tool === "run_dom_health_audit"
      ? "check dom health of this page"
      : "check dom health across the whole application";
  await chatAndWait(panel, ask, { timeout: 150_000 });
  const result = toolResults(model.requests.at(-1)).at(-1);
  await panel.close();
  await page.close();
  return result;
}

function frame(result, key) {
  return result.frames.find((f) => f.key === key);
}

describe("DOM Health on six application shapes", () => {
  it("deep shadow DOM: finds and resolves controls three shadow roots down", async () => {
    const result = await audit("/deep.html", "run_dom_health_audit");

    assert.equal(result.available, true, JSON.stringify(result).slice(0, 400));
    const depths = result.elementSamples.map((s) => s.shadowDepth);
    assert.deepEqual(depths, [3, 3], JSON.stringify(result.elementSamples));
    assert.equal(typeof result.score, "number");
  });

  it("a 251-shadow-root page audits inside the budget, yielding to the page", async () => {
    const result = await audit("/ln-sized.html", "run_dom_health_audit");

    const p = result.performance;
    assert.equal(result.shadowDom.roots, 251);
    assert.deepEqual(p.partialReasons, []);
    assert.ok(p.timings.totalMs < p.limits.timeBudgetMs, JSON.stringify(p));
    assert.ok(
      p.longestSliceMs <= p.limits.sliceMs + p.longestStepMs + 1,
      JSON.stringify(p),
    );
    console.log(
      `251-root page in Chromium: ${p.timings.totalMs} ms per collection, longest slice ${p.longestSliceMs} ms, longest step ${p.longestStepMs} ms, ${p.yields} yields, audit ${p.auditMs} ms`,
    );
  });

  it("legacy frameset: scores the application frame, reports navigation and status frames unscored", async () => {
    const result = await audit("/frameset.html", "run_dom_health_audit");

    assert.equal(frame(result, "GlobalNav")?.role, "chrome");
    assert.equal(frame(result, "Status")?.role, "chrome");
    assert.equal(frame(result, "GlobalWrapper")?.role, "application");
    assert.equal(typeof frame(result, "GlobalWrapper")?.score, "number");
    assert.equal(frame(result, "top")?.role, "chrome");
    assert.equal(result.coverage.elementsAnalyzed, 2);
  });

  it("cross-origin app-in-iframe portal: keys the app frame by data-osp-id and scores it, not the shell", async () => {
    const result = await audit("/portal.html", "run_dom_health_audit");

    const ln = frame(result, "LN");
    assert.equal(ln?.role, "application", JSON.stringify(result.frames));
    assert.equal(ln?.status, "captured");
    assert.equal(typeof ln?.score, "number");
    assert.equal(frame(result, "top")?.role, "chrome");
    assert.equal(result.coverage.elementsAnalyzed, 2);
    assert.doesNotMatch(JSON.stringify(result), /FAKETENANT000000_TRN/);
  });

  it("pushState SPA: audits each route by URL", async () => {
    const result = await audit(
      "/spa/orders",
      "run_application_dom_health_audit",
      { maxPages: 3, discoveryMode: "application-safe" },
    );

    assert.equal(result.coverage.pagesAudited, 2, JSON.stringify(result.pages));
    assert.equal(result.traversal.mode, "url-first");
    // Loaded by URL, the routes never call pushState here; counting the
    // page's own pushState calls is covered by dom-health-routing.e2e.
    assert.deepEqual(
      result.pages
        .filter((p) => p.status === "completed")
        .map((p) => new URL(p.url).pathname),
      ["/spa/orders", "/spa/customers"],
    );
  });

  it("click-only application: traverses by click, restores by click replay, and says why", async () => {
    const result = await audit(
      "/click.html",
      "run_application_dom_health_audit",
      { maxPages: 5, discoveryMode: "application-deep" },
    );

    assert.equal(result.traversal.mode, "click-first");
    assert.equal(result.coverage.pagesAudited, 3, JSON.stringify(result.pages));
    assert.ok(result.restorations.length >= 1);
    assert.ok(result.restorations.every((r) => r.success));
    assert.match(result.traversal.history[0].reason, /0 distinct link target/);
  });

  it("third-party overlay: leaves Pendo and the chat launcher out, and counts them", async () => {
    const result = await audit("/overlay.html", "run_dom_health_audit");

    const matchers = result.excludedRoots.map((r) => r.matcher);
    // The Agent's own UI is in the page during a run, and is left out too.
    assert.deepEqual(matchers, ["id:_pendo-", "id:aipex-", "id:intercom-"]);
    assert.equal(result.coverage.elementsAnalyzed, 2);
  });
});
