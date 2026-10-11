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

/** A react-window style grid: 1,000 rows declared, 15 rendered at their absolute positions, scrolled to row 100. */
const VIRTUALIZED_PAGE = `<!doctype html><title>Orders grid</title><body>
  <h1>Orders</h1>
  <div id="grid" role="grid" aria-rowcount="1000" style="height:450px;overflow:auto">
    <div style="position:relative;height:30000px">${Array.from(
      { length: 15 },
      (_, i) =>
        `<div role="row" data-index="${100 + i}" style="position:absolute;top:${(100 + i) * 30}px;height:30px"><div role="gridcell"><button type="button" data-testid="open-${100 + i}">Open order ${100 + i}</button></div></div>`,
    ).join("")}</div>
  </div>
  <script>document.getElementById("grid").scrollTop = 3000;</script>
</body>`;

/** The LN portal's own URL shape: the tenant as the first path segment, the open screen as base64 JSON in `favoriteContext`. */
const LN_TENANT = "FAKE7ENANT00ABCD_TRN";
const LN_CONTEXT = Buffer.from(
  JSON.stringify({
    description: "Purchase Order Intake Workbench",
    type: "session",
    action: "tdpur4601m200",
  }),
).toString("base64");
const LN_PORTAL_SEED = (
  otherOrigin,
) => `<!doctype html><title>Portal</title><body>
  <div role="tablist"><div role="tab" aria-selected="true">LN</div><div role="tab" tabindex="0">Open tab menu</div></div>
  <main><h1>Workbench</h1><form><input name="order" aria-label="Order"><button type="button">Find</button></form></main>
  <footer><a href="${otherOrigin}/ln.html">Infor</a></footer>
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
    "/virtualized.html": VIRTUALIZED_PAGE,
    [`/${LN_TENANT}/123456`]: () =>
      LN_PORTAL_SEED(`http://localhost:${other.address().port}`),
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

  it("LN portal URL: no tenant or screen context reaches the model; the other-site link and the clicked tab say what happened", async () => {
    const result = await audit(
      `/${LN_TENANT}/123456?favoriteContext=${LN_CONTEXT}&LogicalId=lid%3A%2F%2Finfor.ln.ln01`,
      "run_application_dom_health_audit",
      { maxPages: 5, discoveryMode: "application-deep" },
    );
    const json = JSON.stringify(result);

    assert.ok(!json.includes(LN_TENANT), json.slice(0, 600));
    assert.ok(!json.includes(LN_CONTEXT.slice(0, 24)), json.slice(0, 600));
    assert.ok(!json.includes("Purchase Order"), json.slice(0, 600));
    const offSite = result.pages.find((p) => p.url.includes("/ln.html"));
    assert.equal(offSite?.discoverySource, "cross-origin-link", json);
    assert.equal(offSite?.status, "skipped-cross-origin");
    const tab = result.pages.find(
      (p) => p.discoverySource === "safe-navigation-control",
    );
    assert.equal(tab?.status, "not-discovered", json);
    assert.ok(tab.failureReason, json);
    assert.doesNotMatch(json, /off by default/);
  });

  it("third-party overlay: leaves Pendo and the chat launcher out, and counts them", async () => {
    const result = await audit("/overlay.html", "run_dom_health_audit");

    const matchers = result.excludedRoots.map((r) => r.matcher);
    // The Agent's own UI is in the page during a run, and is left out too.
    assert.deepEqual(matchers, ["id:_pendo-", "id:aipex-", "id:intercom-"]);
    assert.equal(result.coverage.elementsAnalyzed, 2);
  });

  it("virtualized grid: reports the rendered and declared rows as partial coverage, and leaves the scroll position alone (B4)", async () => {
    const page = await browser.context.newPage();
    await page.goto(`${site.origin}/virtualized.html`);
    await page.waitForLoadState("load");
    const scrollBefore = await page.evaluate(
      () => document.getElementById("grid").scrollTop,
    );
    const panel = await openSidePanel(browser, model, page);
    model.script(callToolThenReport("run_dom_health_audit", {}));
    await chatAndWait(panel, "check dom health of this page", {
      timeout: 150_000,
    });
    const result = toolResults(model.requests.at(-1)).at(-1);

    assert.deepEqual(
      {
        containers: result.virtualized.containers,
        observedItems: result.virtualized.observedItems,
        declaredTotal: result.virtualized.declaredTotal,
      },
      { containers: 1, observedItems: 15, declaredTotal: 1000 },
      JSON.stringify(result.virtualized),
    );
    // Real layout also shows the grid scrolling far beyond its rows.
    assert.deepEqual(result.virtualized.samples[0].signals, [
      "aria-count",
      "index-gap",
      "scroll-height",
    ]);
    assert.equal(result.confidence, "LOW");
    assert.ok(
      result.confidenceCaps.includes(
        "1 virtualized list(s) render 15 of 1000 declared rows; the other 985 were not audited.",
      ),
      JSON.stringify(result.confidenceCaps),
    );
    assert.ok(
      result.risks.some((r) => r.id === "virtualized-list-partial-coverage"),
    );
    assert.equal(
      await page.evaluate(() => document.getElementById("grid").scrollTop),
      scrollBefore,
    );
    assert.equal(scrollBefore, 3000);
    await panel.close();
    await page.close();
  });

  describe("validation bundle export from the DOM Health card (B2)", () => {
    const OVERRIDES = { sameUrlRatioForClickFirst: 0.4 };
    const SHAPES = [
      { path: "/deep.html", text: ["Sales Orders", ">Deep<"] },
      {
        path: "/frameset.html",
        text: ["Contact Details", "Legal sex", "Frameset"],
      },
      {
        path: "/portal.html",
        text: [
          "Sales Orders",
          "FAKETENANT000000_TRN",
          "inforSessionId",
          "LN_44_",
        ],
      },
      {
        path: "/spa/orders",
        text: ["Open orders", "Customers<"],
        application: true,
      },
      { path: "/click.html", text: ["Edit Orders", "Home"] },
      { path: "/overlay.html", text: ["Registration", "Chat"] },
    ];

    async function exportBundle({ path, application }) {
      const page = await browser.context.newPage();
      await page.goto(`${site.origin}${path}`);
      await page.waitForLoadState("load");
      const panel = await openSidePanel(browser, model, page, {
        developerTools: true,
        domHealthThresholdOverrides: OVERRIDES,
      });
      const run = application ? /audit application/i : /check dom health/i;
      await panel.getByRole("button", { name: run }).click();
      const exportButton = panel.getByRole("button", {
        name: "Export validation bundle",
      });
      await exportButton.waitFor();
      await panel
        .locator("text=/Last checked/")
        .first()
        .waitFor({ timeout: 150_000 });
      await exportButton.click();
      await panel.getByText("Review before sharing").waitFor();
      const json = await panel.getByLabel("Validation bundle").textContent();
      const version = await panel.evaluate(
        () => chrome.runtime.getManifest().version,
      );
      await panel.getByRole("button", { name: "Cancel" }).click();
      await panel.close();
      await page.close();
      return { json, version };
    }

    for (const shape of SHAPES) {
      it(`${shape.path}: exports the schema with no page text, titles, queries or tenant ids`, async () => {
        const { json, version } = await exportBundle(shape);
        const bundle = JSON.parse(json);

        assert.equal(bundle.schema, "apty-dom-health-validation/1");
        assert.equal(bundle.versions.extension, version);
        assert.match(bundle.versions.chrome, /^\d+\.\d+\.\d+\.\d+$/);
        assert.ok(bundle.hosts.includes(new URL(site.origin).hostname), json);
        assert.deepEqual(bundle.thresholdOverrides.active, [
          { name: "sameUrlRatioForClickFirst", value: 0.4, default: 0.5 },
        ]);
        const audit = shape.application ? bundle.application : bundle.page;
        assert.ok(audit, json.slice(0, 400));
        if (shape.application) {
          assert.equal(bundle.application.coverage.pagesAudited, 2, json);
        } else {
          assert.ok(bundle.page.frames.length >= 1, json);
        }
        for (const text of shape.text) {
          assert.ok(!json.includes(text), `${text} leaked: ${json}`);
        }
        const templates = [...json.matchAll(/"urlTemplate": "([^"]*)"/g)].map(
          (m) => m[1],
        );
        assert.ok(templates.length > 0, json);
        assert.ok(
          templates.every((t) => !t.includes("?")),
          templates.join(),
        );
      });
    }
  });
});
