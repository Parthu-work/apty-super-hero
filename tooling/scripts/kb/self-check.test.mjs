/**
 * KB-RAG K25, A3: every card finds itself. `kb:eval --self-check` on a
 * deliberately broken pack, on the 110-card large synthetic pack with the
 * builder's defaults, and an unknown tab version over two packs that share
 * a title.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildPack, packSha256 } from "./build-kb-pack.mjs";
import { formatSelfCheck, loadAgentCore, run, selfCheck } from "./eval-kb.mjs";
import {
  LARGE_SYNTHETIC_PAGES,
  LARGE_SYNTHETIC_VERSION,
} from "./fixtures/large-synthetic-cards.mjs";
import { SYNTHETIC_PAGES } from "./fixtures/synthetic-cards.mjs";

let core;
let dir;

/** A card copied five times: the fourth and fifth copy cannot be in the top 3. */
const BROKEN_PAGES = [1, 2, 3, 4, 5].map((n) => ({
  ...SYNTHETIC_PAGES[0],
  id: String(9000 + n),
}));

const build = (pages, extra = {}) =>
  buildPack({
    pages,
    site: "synthetic.atlassian.invalid",
    space: "LS",
    label: "rag-card",
    builtAt: "2026-11-12T00:00:00.000Z",
    aptyVersion: LARGE_SYNTHETIC_VERSION,
    ...extra,
  }).pack;

before(async () => {
  core = await loadAgentCore();
  dir = mkdtempSync(join(tmpdir(), "kb-self-check-"));
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("the large synthetic pack", () => {
  it("is 110 cards in 17 groups: 89 full with four 600-750 character layers, 10 stubs, 6 routing, 5 not in this version", () => {
    assert.equal(LARGE_SYNTHETIC_PAGES.length, 110);
    assert.equal(new Set(LARGE_SYNTHETIC_PAGES.map((p) => p.group)).size, 17);
    const pack = build(LARGE_SYNTHETIC_PAGES);
    const count = (status) =>
      pack.cards.filter((card) => card.status === status).length;
    assert.deepEqual(
      [count("full"), count("stub"), count("routing")],
      [89, 10, 6],
    );
    for (const chunk of pack.chunks) {
      assert.ok(
        chunk.text.length >= 600 && chunk.text.length <= 750,
        `${chunk.id}: ${chunk.text.length}`,
      );
    }
    assert.ok(pack.cards.every((card) => card.symptom));
    assert.ok(LARGE_SYNTHETIC_PAGES.every((p) => p.body.includes("FIXTURE")));
  });

  it("with the builder's defaults, every title finds its card in the top 3 and at least 95% at rank 1", () => {
    const report = selfCheck(core, build(LARGE_SYNTHETIC_PAGES));
    assert.deepEqual(report.coverage, { min: 0.5, minIdf: 1.5, minTerms: 1 });
    assert.equal(report.titles.top3, report.titles.of);
    assert.ok(
      report.titles.rank1 / report.titles.of >= 0.95,
      formatSelfCheck(report),
    );
    assert.deepEqual(report.failingTitles, []);
    assert.equal(report.symptoms.top3, report.symptoms.of);
  });
});

describe("selfCheck", () => {
  it("reports a broken pack: a card copied five times cannot find every copy, and the ids that fail are named", () => {
    const report = selfCheck(core, build(BROKEN_PAGES));
    assert.deepEqual(report.failingTitles, ["9004", "9005"]);
    const first = report.queries.find((q) => q.pageId === "9004");
    assert.deepEqual(Object.keys(first).sort(), [
      "coverage",
      "kind",
      "min",
      "pageId",
      "rank",
      "status",
      "topPageId",
    ]);
    assert.equal(first.rank, 4);
    assert.equal(first.status, "ok");
    assert.equal(first.topPageId, "9001");
    assert.equal(first.min, 0.5);
  });

  it("names a title that is not covered, with its reason and coverage", () => {
    const short = ["Glowing banner", "Double tooltip", "Blank survey"].map(
      (title, i) => ({ ...SYNTHETIC_PAGES[i], title: `RAG Card: ${title}` }),
    );
    const report = selfCheck(core, build(short), {
      coverage: { min: 0.5, minIdf: 50, minTerms: 1 },
    });
    const notCovered = report.queries.filter(
      (q) => q.kind === "title" && q.status === "not_covered",
    );
    assert.equal(notCovered.length, 3);
    for (const q of notCovered) {
      assert.equal(q.rank, 0);
      assert.ok(report.failingTitles.includes(q.pageId));
      assert.ok(q.reason);
      assert.equal(q.min, 0.5);
    }
  });

  it("counts a not-in-this-version card as found when not_in_version comes back with it", () => {
    const pack = build(LARGE_SYNTHETIC_PAGES);
    const absentIds = new Set(
      pack.cards.filter((c) => c.status === "absent").map((c) => c.pageId),
    );
    const report = selfCheck(core, pack);
    const absentTitles = report.queries.filter(
      (q) => q.kind === "title" && absentIds.has(q.pageId),
    );
    assert.equal(absentTitles.length, 5);
    assert.ok(
      absentTitles.every((q) => q.status === "not_in_version" && q.rank === 1),
    );
  });

  it("counts a stub as found when its own stub status comes back", () => {
    const report = selfCheck(core, build(LARGE_SYNTHETIC_PAGES));
    const stubIds = new Set(
      build(LARGE_SYNTHETIC_PAGES)
        .cards.filter((card) => card.status === "stub")
        .map((card) => card.pageId),
    );
    const stubTitles = report.queries.filter(
      (q) => q.kind === "title" && stubIds.has(q.pageId),
    );
    assert.equal(stubTitles.length, 10);
    assert.ok(stubTitles.every((q) => q.status === "stub" && q.rank === 1));
  });

  it("the CLI needs no questions file, prints ids, numbers and codes only, and exits 1 on a failing title", async () => {
    const good = join(dir, "large.json");
    writeFileSync(good, JSON.stringify(build(LARGE_SYNTHETIC_PAGES)));
    const out = [];
    assert.equal(
      await run({
        argv: ["--pack", good, "--self-check"],
        out: (l) => out.push(l),
      }),
      0,
    );
    const text = out.join("\n");
    assert.match(text, /Titles: rank 1 \d+ of 104/);
    for (const page of LARGE_SYNTHETIC_PAGES.slice(0, 20)) {
      const title = page.title.replace(/^RAG Card:\s*/, "");
      assert.ok(!text.includes(title), "no card title in the output");
    }
    const bad = join(dir, "broken.json");
    writeFileSync(bad, JSON.stringify(build(BROKEN_PAGES)));
    const lines = [];
    assert.equal(
      await run({
        argv: ["--pack", bad, "--self-check"],
        out: (l) => lines.push(l),
      }),
      1,
    );
    assert.match(lines.join("\n"), /Titles not found in the top 3: 9004, 9005/);
  });
});

describe("an unknown tab version over two packs (K25, A3)", () => {
  it("returns the card from both versions for a title both hold, labelled with each version", () => {
    const shared = LARGE_SYNTHETIC_PAGES.slice(0, 30);
    const four = build(shared);
    const fiveCards = build(
      shared.map((page) => ({ ...page, id: String(Number(page.id) + 1000) })),
      { aptyVersion: "5.x" },
    );
    const index = core.createKbIndexSet([four, fiveCards], {
      tabVersion: "unknown",
    });
    const title = four.cards[5].title;
    const result = index.search(title, { topK: 3, onePerCard: true });
    assert.equal(result.status, "ok");
    assert.deepEqual(
      result.hits.slice(0, 2).map((hit) => [hit.chunk.pageId, hit.aptyVersion]),
      [
        [four.cards[5].pageId, "4.x"],
        [String(Number(four.cards[5].pageId) + 1000), "5.x"],
      ],
    );
    assert.equal(result.mixedVersions, true);
    assert.equal(packSha256(four), four.sha256);
  });
});
