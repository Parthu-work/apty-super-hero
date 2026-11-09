import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { buildPack, packSha256 } from "./build-kb-pack.mjs";
import {
  calibrate,
  calibrateCoverage,
  evaluate,
  idfPercentiles,
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
let v2File;
let v2;

/** The same cards as a schema 1 pack, which keeps its score threshold. */
function asSchema1(built) {
  const { sha256: _old, ...rest } = { ...built, schemaVersion: 1 };
  return { ...rest, sha256: packSha256(rest) };
}
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
  writeFileSync(packFile, JSON.stringify(asSchema1(built.pack)));
  pack = await readPack(core, readFileSync(packFile, "utf8"));
  v2File = join(dir, "pack-v2.json");
  writeFileSync(v2File, JSON.stringify(built.pack));
  v2 = await readPack(core, readFileSync(v2File, "utf8"));
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

describe("calibrateCoverage (schema 2)", () => {
  it("finds the coverage settings that sort every synthetic question, without losing Recall@3", () => {
    const suggested = calibrateCoverage(core, v2, questions);
    assert.equal(suggested.j, 1);
    assert.equal(suggested.recallAt3, suggested.uncappedRecallAt3);
    assert.ok(
      idfPercentiles(core.createKbIndex(v2)).includes(suggested.minIdf),
    );
    const report = evaluate(core, v2, questions, {
      coverage: {
        min: suggested.min,
        minIdf: suggested.minIdf,
        minTerms: suggested.minTerms,
      },
    });
    assert.equal(report.recallAt3, 1);
    assert.equal(report.notCoveredPrecision, 1);
    assert.equal(report.notCoveredRecall, 1);
    assert.equal(report.threshold, null);
    assert.deepEqual(calibrateCoverage(core, v2, questions), suggested);
  });

  it("counts a stub as a hit when it is the expected card", async () => {
    const withStub = buildPack({
      pages: [
        ...SYNTHETIC_PAGES,
        {
          id: "1099",
          title: "RAG Card: FIXTURE gadget export never finishes",
          group: "FIXTURE group",
          updatedAt: "2026-02-01T00:00:00.000Z",
          body: "<p>Symptom: exporting FIXTURE gadgets hangs.</p><p>The 5.x version not yet written.</p>",
        },
      ],
      site: "fixture.atlassian.net",
      space: "FX",
      label: "rag-card",
      builtAt: "2026-03-01T00:00:00.000Z",
    }).pack;
    const report = evaluate(
      core,
      await readPack(core, JSON.stringify(withStub)),
      [
        {
          id: "st1",
          q: "gadget export never finishes",
          expectedPageIds: ["1099"],
        },
      ],
    );
    assert.equal(report.recallAt1, 1);
    assert.deepEqual(report.misses, []);
  });

  it("does not let a threshold change a schema 2 pack's answers", () => {
    assert.deepEqual(
      evaluate(core, v2, questions, { threshold: 1_000 }).misses,
      evaluate(core, v2, questions).misses,
    );
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

  it("suggests the coverage flags for a schema 2 pack, and evaluates with them", async () => {
    const lines = [];
    const out = (line) => lines.push(line);
    const argv = ["--pack", v2File, "--questions", QUESTIONS_FILE.pathname];
    assert.equal(
      await run({ argv: [...argv, "--calibrate"], out, err: out }),
      0,
    );
    const flags =
      /Build with --coverage-min ([\d.]+) --coverage-min-idf ([\d.]+)\./.exec(
        lines.join("\n"),
      );
    assert.ok(flags, lines.join("\n"));
    lines.length = 0;
    const code = await run({
      argv: [
        ...argv,
        "--coverage-min",
        flags[1],
        "--coverage-min-idf",
        flags[2],
      ],
      out,
      err: out,
    });
    assert.equal(code, 0);
    assert.match(
      lines.join("\n"),
      new RegExp(`coverage min ${flags[1]}, minIdf ${flags[2]}, minTerms 1`),
    );
    assert.match(
      lines.join("\n"),
      /"not covered" precision 100\.0% {2}recall 100\.0%/,
    );
  });

  it("prints the metrics per category, by id only", async () => {
    const file = join(dir, "categorized.json");
    writeFileSync(
      file,
      JSON.stringify([
        {
          id: "a1",
          q: "the banner never glows",
          expectedPageIds: ["1001"],
          category: "short",
        },
        {
          id: "b1",
          q: "kubernetes helm chart rollout",
          expectedPageIds: [],
          category: "not-covered-domain",
        },
        {
          id: "c1",
          q: "how do I configure a launcher",
          expectedPageIds: [],
          category: "how-to",
          surface: "responder",
        },
      ]),
    );
    const lines = [];
    const code = await run({
      argv: ["--pack", v2File, "--questions", file, "--by-category"],
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    const text = lines.join("\n");
    assert.equal(code, 0, text);
    assert.match(
      text,
      /^ {2}not-covered-domain: 1 q, .*not covered P 100% R 100%$/m,
    );
    assert.match(text, /^ {2}short: 1 q, R@1 100%, R@3 100%/m);
    assert.match(text, /^ {2}how-to: left to the responder's tests$/m);
    assert.match(text, /^2 questions \(1 the KB should cover\)/m);
    assert.ok(!text.includes("kubernetes"));
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
