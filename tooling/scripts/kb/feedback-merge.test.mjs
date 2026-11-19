/**
 * KB-RAG K28 A4: merging the SEs' feedback exports for the KB owner. Two
 * synthetic SEs' overlapping exports (fixtures/feedback-exports) merge to
 * one tracking sheet and one question set per version, and the merged
 * questions pass kb:eval on the demo packs.
 */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { run as buildDemo } from "./build-demo-pack.mjs";
import { run as evaluate } from "./eval-kb.mjs";
import {
  run as merge,
  mergeFeedback,
  parseCsv,
  trackingColumns,
} from "./feedback-merge.mjs";

const EXPORTS = fileURLToPath(
  new URL("./fixtures/feedback-exports", import.meta.url),
);
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "apty-feedback-merge-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function mergeInto(out, input = EXPORTS) {
  const lines = [];
  const code = await merge({
    argv: ["--in", input, "--out", out],
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
  });
  return { code, text: lines.join("\n") };
}

const sheet = (out, version) =>
  parseCsv(readFileSync(join(out, `tracking-${version}.csv`), "utf8"));

const pick = (row) =>
  [row["date"], row["case id"], row["card shown"], row["outcome"], row["mark"]]
    .map((cell) => cell || "-")
    .join(" ");

describe("feedback-merge", () => {
  it("merges two SEs' overlapping exports to the expected rows per version", async () => {
    const out = join(dir, "merged");
    const { code, text } = await mergeInto(out);
    assert.equal(code, 0, text);
    const v5 = sheet(out, "5.x");
    assert.deepEqual(v5.header, ["id", ...(await trackingColumns())]);
    assert.deepEqual(v5.rows.map(pick), [
      "2026-11-10 CASE-20261110-A1B2 2005#L1 open wrong card",
      "2026-11-11 CASE-20261111-C3D4 2002#L1 open helped",
      "2026-11-13 CASE-20261110-A1B2 2001 resolved -",
      "2026-11-14 CASE-20261112-J9K0 2003#L1 escalated wrong card",
      "2026-11-14 - 2004#L1 - helped",
    ]);
    assert.equal(
      v5.rows[2]["note"],
      'DEMO fix: raised the "hover delay", then republished',
    );
    assert.deepEqual(sheet(out, "4.x").rows.map(pick), [
      "2026-11-11 - 4001#L1 - helped",
      "2026-11-12 CASE-20261112-G7H8 4006#L1 open wrong card",
      "2026-11-13 CASE-20261113-E5F6 - not_covered -",
    ]);
    const ids = [...v5.rows, ...sheet(out, "4.x").rows].map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^fb-[0-9a-f]{10}$/);
  });

  it("writes one question set per version, deduplicated, with no text the SEs did not give", async () => {
    const out = join(dir, "merged-q");
    await mergeInto(out);
    const read = (version) =>
      JSON.parse(readFileSync(join(out, `questions-${version}.json`), "utf8"));
    const given = readdirSync(EXPORTS, { recursive: true })
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) =>
        JSON.parse(readFileSync(join(EXPORTS, name), "utf8")).map((q) => q.q),
      );
    const v5 = read("5.x");
    const v4 = read("4.x");
    assert.deepEqual(
      v5.map((q) => q.expectedPageIds),
      [["2001"], ["2002"]],
    );
    assert.deepEqual(
      v4.map((q) => q.expectedPageIds),
      [["4002"]],
    );
    for (const question of [...v5, ...v4]) {
      assert.ok(given.includes(question.q), question.id);
      assert.match(question.id, /^field-[0-9a-f]{10}$/);
      assert.equal(question.category, "field");
    }
  });

  it("gives the same files and ids on every run", async () => {
    const first = join(dir, "run-1");
    const second = join(dir, "run-2");
    await mergeInto(first);
    await mergeInto(second);
    for (const name of readdirSync(first)) {
      assert.equal(
        readFileSync(join(first, name), "utf8"),
        readFileSync(join(second, name), "utf8"),
        name,
      );
    }
  });

  it("summarizes counts by version and outcome, and names what it skipped", async () => {
    const out = join(dir, "merged-summary");
    const { text } = await mergeInto(out);
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    assert.deepEqual(summary.input, {
      trackingFiles: 3,
      questionFiles: 3,
      skippedFiles: ["se-beta/apty-pilot-measures-2026-11-14.csv"],
      rows: 12,
      questions: 5,
    });
    assert.deepEqual(summary.versions["5.x"], {
      rows: 5,
      duplicateRows: 3,
      questions: 2,
      duplicateQuestions: 2,
      outcomes: { open: 2, resolved: 1, escalated: 1, none: 1 },
      marks: { "wrong card": 2, helped: 2 },
    });
    assert.deepEqual(summary.versions["4.x"].outcomes, {
      open: 1,
      not_covered: 1,
      none: 1,
    });
    assert.match(text, /5\.x: 5 rows \(3 duplicates removed\), 2 questions/);
    for (const question of ["flickering", "walkthrough", "balloon"]) {
      assert.ok(!text.includes(question), "no question text on screen");
    }
  });

  it("refuses an --out inside the repository and writes nothing", async () => {
    const inside = join(REPO, "tooling", "feedback-merge-should-not-exist");
    const { code, text } = await mergeInto(inside);
    assert.equal(code, 2);
    assert.match(text, /outside the repository/);
    assert.ok(
      !readdirSync(join(REPO, "tooling")).includes(
        "feedback-merge-should-not-exist",
      ),
    );
  });

  it("puts a question whose card no tracking row names under unknown", () => {
    const merged = mergeFeedback({
      tracking: [],
      questions: [
        {
          source: "se-gamma/q.json",
          items: [{ q: "FIXTURE orphan question", expectedPageIds: ["9999"] }],
        },
      ],
    });
    assert.deepEqual(Object.keys(merged.versions), ["unknown"]);
    assert.equal(merged.versions.unknown.questions.length, 1);
  });

  it("names a file it cannot read", async () => {
    const input = mkdtempSync(join(dir, "broken-"));
    writeFileSync(join(input, "apty-kb-questions-x.json"), "{ not json");
    const { code, text } = await mergeInto(join(dir, "broken-out"), input);
    assert.equal(code, 1);
    assert.match(text, /apty-kb-questions-x\.json: not valid JSON/);
  });
});

describe("the merged questions on the demo packs", () => {
  it("pass kb:eval: every merged question finds its card in the top 3", async () => {
    const home = mkdtempSync(join(dir, "demo-home-"));
    const out = join(dir, "merged-eval");
    await mergeInto(out);
    for (const version of ["4.x", "5.x"]) {
      const lines = [];
      assert.equal(
        await buildDemo({
          argv: ["--version", version],
          home,
          now: () => new Date("2026-11-09T00:00:00.000Z"),
          out: (line) => lines.push(line),
          err: (line) => lines.push(line),
        }),
        0,
        lines.join("\n"),
      );
      const report = [];
      const code = await evaluate({
        argv: [
          "--pack",
          join(home, "apty-kb", `apty-kb-DEMO-${version}.kbpack.json`),
          "--questions",
          join(out, `questions-${version}.json`),
          "--json",
        ],
        out: (line) => report.push(line),
        err: (line) => report.push(line),
      });
      assert.equal(code, 0, report.join("\n"));
      const metrics = JSON.parse(report.join("\n"));
      assert.equal(metrics.recallAt3, 1, version);
      assert.deepEqual(metrics.misses, [], version);
    }
  });
});
