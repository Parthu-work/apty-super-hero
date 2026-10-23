/**
 * DOM Config's automatic crawl in a real browser (R3): a small application
 * of four pages linked by anchors, crawled in safe and deep mode, two runs
 * per state, analyzed by the engine. Nothing in the extension calls the
 * crawl yet (the side panel card comes later), so the test bundles
 * `runDomConfigCapture` from source and runs it in an extension page,
 * with the extension's own permissions and content scripts.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  launchBrowser,
  extensionPage as openExtensionPage,
  ROOT,
  startPageServer,
} from "./harness.mjs";

const PAGES = ["home", "list", "detail", "form"];
const TITLE = "Clinic for Jane Example";

let loads = 0;

function appPage(name, crossOrigin) {
  loads += 1;
  const stamp = 1_700_000_000_000 + loads;
  const nav = PAGES.map(
    (p) => `<a href="/${p}?nocache=${stamp}">${p}</a>`,
  ).join("");
  const rows = Array.from(
    { length: 8 },
    (_, i) => `<tr class="RptTable"><td data-col="c${i}">${i}</td></tr>`,
  ).join("");
  const menu =
    name === "home"
      ? `<nav role="menu" aria-label="Sections"><div role="menuitem" id="m-reports">Reports</div></nav>`
      : "";
  const frames =
    name === "home"
      ? `<iframe id="notes" src="/frame.html"></iframe><iframe id="viewer" src="${crossOrigin}/frame.html"></iframe>`
      : "";
  return `<!doctype html><html lang="en"><head><title>${TITLE}</title></head><body>
  <nav id="main-nav">${nav}</nav>
  ${menu}
  <main id="view"><h1>${name}</h1>
    <div id="ui-id-${loads}" class="panel">a</div><div id="ui-id-${loads + 1}" class="panel">b</div>
    <div id="provCheck_1009116120" class="check">c</div>
    <input name="search" placeholder="Search">
    <table id="grid">${rows}</table>
    <x-card id="card"></x-card>
  </main>
  ${frames}
  <img id="pm-icon" alt="" style="position: fixed; z-index: 999999; top: 0; left: 0">
  <div id="toast" style="position: fixed; z-index: 9999"></div>
  <apty-widget><div class="tip" data-apty-step="s${loads}">Apty tip</div></apty-widget>
  <script>
    document.getElementById("card").attachShadow({ mode: "open" }).innerHTML =
      '<header class="title">Card</header><button class="card-action">Open</button>';
    const item = document.getElementById("m-reports");
    if (item) {
      item.addEventListener("click", () => {
        document.getElementById("view").innerHTML =
          '<h1>Reports</h1><div id="report-panel" class="panel">r</div>';
      });
    }
  </script>
</body></html>`;
}

const FRAME_PAGE = `<!doctype html><html><head></head><body>
  <form id="notes-form"><textarea name="note" placeholder="Note"></textarea></form>
</body></html>`;

let browser;
let serverA;
let serverB;
let bundle;

async function bundleCrawl() {
  const fromExtension = createRequire(
    join(ROOT, "apps/browser-extension/package.json"),
  );
  const fromVite = createRequire(fromExtension.resolve("vite"));
  const esbuild = await import(fromVite.resolve("esbuild"));
  const out = await esbuild.build({
    stdin: {
      contents: `import { buildReportFromCapture, runDomConfigCapture } from "./src/apty/dom-config/crawl.ts";
        Object.assign(globalThis, { buildReportFromCapture, runDomConfigCapture });`,
      resolveDir: join(ROOT, "packages/browser-runtime"),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    logLevel: "error",
  });
  return out.outputFiles[0].text;
}

before(async () => {
  const pagesFor = (other) => ({
    ...Object.fromEntries(
      PAGES.map((name) => [`/${name}`, () => appPage(name, other())]),
    ),
    "/frame.html": FRAME_PAGE,
  });
  serverA = await startPageServer(
    pagesFor(() => `http://localhost:${serverB.address().port}`),
  );
  serverB = await startPageServer(pagesFor(() => serverA.origin));
  [browser, bundle] = await Promise.all([launchBrowser(), bundleCrawl()]);
});

after(async () => {
  await browser?.close();
  serverA?.close();
  serverB?.close();
});

/** Crawl the tab showing `/home` from an extension page and return the outcome. */
async function crawl(options) {
  const page = await browser.context.newPage();
  await page.goto(`${serverA.origin}/home?nocache=1700000000000`);
  await page.waitForLoadState("load");
  const ext = await openExtensionPage(browser);
  try {
    await ext.evaluate(bundle);
    const outcome = await ext.evaluate(async (options) => {
      const [tab] = await chrome.tabs.query({ url: "http://127.0.0.1/*" });
      return globalThis.runDomConfigCapture(tab.id, {
        probeWindowMs: 500,
        ...options,
      });
    }, options);
    return { outcome, finalUrl: page.url() };
  } finally {
    await ext.close();
    await page.close();
  }
}

function conditionText(rule) {
  return rule.conditions
    .map((c) => `${c.category} ${c.operator} ${c.value}`)
    .join(" AND ");
}

describe("DOM Config crawl in Chromium", () => {
  it("safe mode: captures each linked page twice and derives rules from what changed", async () => {
    const { outcome, finalUrl } = await crawl({});
    assert.equal(outcome.available, true, outcome.error);
    const { capture, report, inventory } = outcome;

    assert.deepEqual(
      capture.pages.map((p) => [
        new URL(p.pageId).pathname,
        p.runs.map((r) => r.meta.label).join(","),
        p.runs.some((r) => r.meta.stateMismatch),
      ]),
      PAGES.map((name) => [`/${name}`, "initial,after-reload", false]),
    );
    assert.ok(
      capture.pages.every((p) => p.pageId.endsWith("?nocache")),
      "page ids keep query names only",
    );
    assert.equal(new URL(finalUrl).pathname, "/home");
    assert.deepEqual(outcome.returnedToSeed, { success: true, reason: null });
    assert.equal(JSON.stringify(outcome).includes(TITLE), false);

    const rules = report.rules.map(conditionText);
    assert.ok(
      rules.includes(
        "Attribute Name Equals href AND Attribute Value Contains nocache",
      ),
      rules.join("\n"),
    );
    const nocache = report.rules.find(
      (r) => r.conditions[1]?.value === "nocache",
    );
    assert.equal(nocache.evidence, "observed_change");
    assert.equal(nocache.confidence, "set-diff");
    const uiId = report.rules.filter((r) =>
      r.conditions.some((c) => c.value === "^ui-id-\\d+$"),
    );
    assert.equal(uiId.length, 1, rules.join("\n"));
    assert.equal(
      rules.some((r) => /apty|data-apty-step/i.test(r)),
      false,
      rules.join("\n"),
    );
    assert.ok(
      JSON.stringify(report.coveredByDefaults).includes("provCheck_"),
      JSON.stringify(report.coveredByDefaults),
    );

    assert.equal(report.maxZIndex.appMax, 9999);
    assert.equal(report.maxZIndex.value, 2147483646);
    assert.ok(
      report.maxZIndex.excluded.some((e) => e.value === 999999),
      JSON.stringify(report.maxZIndex),
    );
    const viewer = report.iframes.find((f) => f.crossOrigin);
    assert.equal(
      viewer?.src,
      `http://localhost:${serverB.address().port}/frame.html`,
    );
    assert.ok(report.warnings.some((w) => w.code === "weak-selectors"));
    assert.deepEqual(
      report.weakSelectors.find((w) => w.selector === ".RptTable")?.maxPerPage,
      8,
      JSON.stringify(report.weakSelectors),
    );
    assert.ok(
      inventory.some((r) => r.status === "not-discovered" && r.control),
      JSON.stringify(inventory),
    );
    assert.equal(
      capture.pages.some((p) => p.pageId.includes("[state-")),
      false,
    );
  });

  it("deep mode: also captures the menu-driven state, restoring it by replay for run 2", async () => {
    const { outcome } = await crawl({ discoveryMode: "application-deep" });
    assert.equal(outcome.available, true, outcome.error);
    const menuState = outcome.capture.pages.find((p) =>
      p.pageId.includes("[state-"),
    );
    assert.ok(
      menuState,
      JSON.stringify(outcome.capture.pages.map((p) => p.pageId)),
    );
    assert.deepEqual(
      menuState.runs.map((r) => [r.meta.label, Boolean(r.meta.stateMismatch)]),
      [
        ["initial", false],
        ["after-reload", false],
      ],
    );
    assert.equal(outcome.returnedToSeed.success, true);
  });

  it("renders byte-identical Markdown from the same capture", async () => {
    const { outcome } = await crawl({ discoveryMode: "page" });
    assert.equal(outcome.available, true, outcome.error);
    const ext = await openExtensionPage(browser);
    try {
      await ext.evaluate(bundle);
      const again = await ext.evaluate(
        (capture) => [
          globalThis.buildReportFromCapture(capture).markdown,
          globalThis.buildReportFromCapture(structuredClone(capture)).markdown,
        ],
        outcome.capture,
      );
      assert.deepEqual(again, [outcome.markdown, outcome.markdown]);
    } finally {
      await ext.close();
    }
  });
});
