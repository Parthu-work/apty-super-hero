import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildPack } from "./build-kb-pack.mjs";
import {
  calibrate,
  evaluate,
  loadAgentCore,
  readPack,
  readQuestions,
  run,
} from "./eval-kb.mjs";
import { SYNTHETIC_PAGES } from "./fixtures/synthetic-cards.mjs";

const QUESTIONS_FILE = new URL(
  "./fixtures/synthetic-questions.json",
  import.meta.url,
);

let core;
let dir;
let packFile;
let pack;
const questions = readQuestions(readFileSync(QUESTIONS_FILE, "utf8"));

before(async () => {
  core = await loadAgentCore();
  dir = mkdtempSync(join(tmpdir(), "kb-eval-"));
  const built = buildPack({
    pages: SYNTHETIC_PAGES,
    site: "fixture.atlassian.net",
    space: "FX",
    label: "rag-card",
    builtAt: "2026-03-01T00:00:00.000Z",
  });
  packFile = join(dir, "pack.json");
  writeFileSync(packFile, JSON.stringify(built.pack));
  pack = await readPack(core, readFileSync(packFile, "utf8"));
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("evaluate", () => {
  it("scores the synthetic set with the extension's own search, the same every run", () => {
    const report = evaluate(core, pack, questions);
    assert.equal(report.questions, 10);
    assert.equal(report.covered, 8);
    assert.equal(report.mode, "bm25");
    assert.equal(report.threshold, null);
    assert.equal(report.recallAt3, 1);
    assert.ok(report.recallAt1 >= 0.875, `Recall@1 ${report.recallAt1}`);
    assert.ok(report.mrr >= 0.9, `MRR ${report.mrr}`);
    assert.deepEqual(evaluate(core, pack, questions), report);
  });

  it("shows what an uncalibrated pack does with questions it should not cover, then a threshold fixes it", () => {
    const loose = evaluate(core, pack, questions, { threshold: null });
    const { threshold } = calibrate(core, pack, questions);
    const tight = evaluate(core, pack, questions, { threshold });
    assert.equal(tight.threshold, threshold);
    assert.equal(tight.notCoveredRecall, 1);
    assert.equal(tight.notCoveredPrecision, 1);
    assert.equal(tight.recallAt3, 1);
    assert.ok(
      (loose.notCoveredRecall ?? 0) <= tight.notCoveredRecall,
      "the threshold does not lose not-covered questions",
    );
  });

  it("names each miss by id with the expected and returned page ids", () => {
    const strict = evaluate(core, pack, questions, { threshold: 1_000 });
    assert.equal(strict.recallAt3, 0);
    assert.equal(strict.notCoveredRecall, 1);
    assert.deepEqual(
      strict.misses.map((m) => m.id),
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
    );
    assert.deepEqual(strict.misses[0], {
      id: "s1",
      expected: ["1001"],
      got: [],
    });
  });
});

describe("calibrate", () => {
  it("picks the lowest threshold that sorts the most questions correctly", () => {
    const result = calibrate(core, pack, questions);
    assert.equal(result.questions, 10);
    assert.equal(result.correctlySorted, 10);
    assert.ok(result.threshold > 0);
    assert.deepEqual(calibrate(core, pack, questions), result);
  });
});

describe("the CLI", () => {
  it("prints the metrics and question ids, never question or card text", async () => {
    const lines = [];
    const code = await run({
      argv: [
        "--pack",
        packFile,
        "--questions",
        QUESTIONS_FILE.pathname,
        "--calibrate",
      ],
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    const text = lines.join("\n");
    assert.equal(code, 0, text);
    assert.match(text, /10 questions \(8 the KB should cover\), bm25/);
    assert.match(text, /Recall@1 .*Recall@3 100\.0%/);
    assert.match(text, /Suggested threshold [\d.]+: sorts 10 of 10/);
    for (const secret of ["kubernetes", "Glowing Banner", "glowIds"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  it("names a refused pack and a bad questions file", async () => {
    const errors = [];
    writeFileSync(join(dir, "bad.json"), "{");
    assert.equal(
      await run({
        argv: [
          "--pack",
          join(dir, "bad.json"),
          "--questions",
          QUESTIONS_FILE.pathname,
        ],
        err: (line) => errors.push(line),
      }),
      1,
    );
    writeFileSync(join(dir, "q.json"), JSON.stringify([{ q: "x" }]));
    assert.equal(
      await run({
        argv: ["--pack", packFile, "--questions", join(dir, "q.json")],
        err: (line) => errors.push(line),
      }),
      1,
    );
    assert.deepEqual(errors, [
      "The pack was refused: not_json",
      'Question 1 needs "q" and "expectedPageIds".',
    ]);
  });
});
