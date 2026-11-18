/**
 * KB-RAG K27, R5: performance budgets with the large synthetic pack (110
 * cards, 17 groups) loaded for both 4.x and 5.x. Fails above the limits:
 * panel open to the first KB answer under 2 s cold and 500 ms warm (p95);
 * the search index built in under 300 ms; a KB search under 50 ms of main
 * thread; the side panel under 150 MB of JS heap with both packs and a
 * 300-turn chat. No AI key, so no model call. Synthetic cards only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { LARGE_SYNTHETIC_PAGES } from "../scripts/kb/fixtures/large-synthetic-cards.mjs";
import { longChat } from "./fixtures/long-chat.mjs";
import {
  launchBrowser,
  openSidePanel,
  openStoredConversation,
  sendChat,
  startMockModel,
  startPageServer,
  tempDir,
} from "./harness.mjs";
import { importPack, writeFixturePack } from "./kb-fixture.mjs";

const BUILDER_COVERAGE = { min: 0.5, minIdf: 1.5, minTerms: 1 };

let browser;
let model;
let site;
let titles;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({
    "/app.html": "<!doctype html><title>App</title><main>FIXTURE app</main>",
  });
  browser = await launchBrowser();
  const dir = tempDir("apty-kb-perf-");
  const four = writeFixturePack(dir, {
    pages: LARGE_SYNTHETIC_PAGES,
    aptyVersion: "4.x",
    coverage: BUILDER_COVERAGE,
  });
  const five = writeFixturePack(dir, {
    pages: LARGE_SYNTHETIC_PAGES.map((page) => ({
      ...page,
      id: String(Number(page.id) + 100000),
    })),
    aptyVersion: "5.x",
    coverage: BUILDER_COVERAGE,
  });
  for (const { file } of [four, five]) await importPack(browser, file);
  // Titles a check pack would claim (visibility, element, logs, the
  // Widget's chat) get a verdict instead of KB cards; the budget is the KB's.
  const CLAIMED =
    /visib|showing|appear|missing|element|select|widget|console|log|error|ready|dapty|chat|assistant/i;
  titles = four.pack.cards
    .filter((card) => (card.status ?? "full") === "full")
    .map((card) => card.title)
    .filter((title) => !CLAIMED.test(title));
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

const p95 = (values) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

/** Sends `question` and resolves once one more KB matches card is shown. */
async function askAndTime(panel, question) {
  const cards = panel.getByRole("region", { name: "KB cards that match" });
  const before = await cards.count();
  const start = Date.now();
  await sendChat(panel, question);
  while ((await cards.count()) <= before) {
    if (Date.now() - start > 30_000) throw new Error(`no KB card: ${question}`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return Date.now() - start;
}

const measures = (panel, name) =>
  panel.evaluate(
    (n) => performance.getEntriesByName(n).map((e) => e.duration),
    name,
  );

describe("performance budgets (KB-RAG K27, R5)", () => {
  it("answers from the KB within budget, cold and warm, and stays under 150 MB", async () => {
    const app = await browser.context.newPage();
    await app.goto(`${site.origin}/app.html`);
    const panel = await openSidePanel(browser, model, app, { aiToken: "" });

    // Cold: the panel's own clock starts when it loads; the index is built
    // by the first question.
    await panel.reload();
    await panel.locator("textarea").first().waitFor();
    await askAndTime(panel, titles[0]);
    const coldMs = await panel.evaluate(() => performance.now());
    assert.ok(
      coldMs < 2000,
      `panel open to first KB answer took ${Math.round(coldMs)} ms`,
    );

    const warm = [];
    for (const title of titles.slice(1, 21)) {
      warm.push(await askAndTime(panel, title));
    }
    assert.ok(p95(warm) < 500, `warm p95 ${p95(warm)} ms: ${warm.join(", ")}`);

    const builds = await measures(panel, "apty:kb-index-build");
    assert.ok(builds.length > 0, "the index build was measured");
    assert.ok(
      Math.max(...builds) < 300,
      `index build ${builds.map(Math.round).join(", ")} ms`,
    );
    const searches = await measures(panel, "apty:kb-search");
    assert.ok(searches.length >= 21, "every KB search was measured");
    assert.ok(
      p95(searches) < 50,
      `KB search p95 ${p95(searches).toFixed(1)} ms`,
    );
    assert.equal(model.requests.length, 0);

    await openStoredConversation(panel, longChat(300));
    await panel.getByText("RESULT 299:").waitFor({ timeout: 60_000 });
    const cdp = await browser.context.newCDPSession(panel);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("Performance.enable");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const heap = metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
    assert.ok(heap > 0, "the heap was read");
    assert.ok(
      heap < 150 * 1024 * 1024,
      `side panel heap ${(heap / 1024 / 1024).toFixed(1)} MB`,
    );

    console.log(
      `R5 measures: panel open to first KB answer ${Math.round(coldMs)} ms, warm p95 ${p95(warm)} ms, index build ${builds.map(Math.round).join("/")} ms, search p95 ${p95(searches).toFixed(1)} ms, heap ${(heap / 1024 / 1024).toFixed(1)} MB`,
    );
    await panel.close();
    await app.close();
  });
});
