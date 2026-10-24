/**
 * DOM Config's automatic crawl in a real browser (R3): the fixture
 * application crawled in safe and deep mode, two runs per state, analyzed
 * by the engine. The test bundles `runDomConfigCapture` from source and
 * runs it in an extension page, with the extension's own permissions and
 * content scripts, so the engine's outcome can be asserted whole; the
 * side panel card is covered by `dom-config-ui.e2e.test.mjs`.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PAGES, startDomConfigApp, TITLE } from "./fixtures/dom-config-app.mjs";
import {
  launchBrowser,
  extensionPage as openExtensionPage,
  ROOT,
} from "./harness.mjs";

let browser;
let app;
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
  app = await startDomConfigApp();
  [browser, bundle] = await Promise.all([launchBrowser(), bundleCrawl()]);
});

after(async () => {
  await browser?.close();
  app?.close();
});

/** Crawl the tab showing `/home` from an extension page and return the outcome. */
async function crawl(options) {
  const page = await browser.context.newPage();
  await page.goto(`${app.origin}/home`);
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
    assert.deepEqual(
      capture.pages.map((p) => p.pageId.slice(app.origin.length)),
      ["/home", "/list?nocache", "/detail?nocache", "/form?nocache"],
      "one /home page; page ids keep query names only",
    );
    assert.ok(
      inventory.some(
        (r) =>
          r.status === "skipped" &&
          r.urlShape === `${app.origin}/home?nocache` &&
          r.reason === `duplicate of ${app.origin}/home`,
      ),
      JSON.stringify(inventory),
    );
    assert.equal(new URL(finalUrl).pathname, "/home");
    assert.deepEqual(outcome.returnedToSeed, { success: true, reason: null });
    assert.equal(JSON.stringify(outcome).includes(TITLE), false);

    const rules = report.rules.map(conditionText);
    assert.equal(
      rules.some((r) => r.startsWith("Attribute Name Equals src")),
      false,
      rules.join("\n"),
    );
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
    assert.equal(viewer?.src, `${app.crossOrigin}/frame.html`);
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
    const menuState = outcome.capture.pages.find(
      (p) => p.runs[0].profile.attributes.id?.["report-panel"],
    );
    assert.ok(
      menuState?.pageId.includes("[state-"),
      JSON.stringify(outcome.capture.pages.map((p) => p.pageId)),
    );
    assert.deepEqual(
      menuState.runs.map((r) => [r.meta.label, Boolean(r.meta.stateMismatch)]),
      [
        ["initial", false],
        ["after-reload", false],
      ],
      JSON.stringify(
        outcome.inventory.find((r) => r.pageId === menuState.pageId),
      ),
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
