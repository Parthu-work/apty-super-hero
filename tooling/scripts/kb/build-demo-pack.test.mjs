import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { kbPackProblems } from "../check-no-kb-pack.mjs";
import { demoQuestionsFile, run } from "./build-demo-pack.mjs";
import {
  evaluate,
  loadAgentCore,
  readPack,
  readQuestions,
} from "./eval-kb.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INTENT = new URL(
  "../../../packages/browser-runtime/dist/src/kb/kb-intent.js",
  import.meta.url,
);

let home;
let core;
const packs = {};
const lines = [];

before(async () => {
  core = await loadAgentCore();
  home = mkdtempSync(join(tmpdir(), "apty-kb-demo-test-"));
  for (const version of ["4.x", "5.x"]) {
    const code = await run({
      argv: ["--version", version],
      home,
      now: () => new Date("2026-11-09T00:00:00.000Z"),
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    assert.equal(code, 0, lines.join("\n"));
    packs[version] = await readPack(
      core,
      readFileSync(
        join(home, "apty-kb", `apty-kb-DEMO-${version}.kbpack.json`),
        "utf8",
      ),
    );
  }
});

after(() => rmSync(home, { recursive: true, force: true }));

describe("kb:demo-pack", () => {
  it("builds a calibrated pack per version outside the repository, with a stub and a routing card", () => {
    for (const [version, pack] of Object.entries(packs)) {
      assert.equal(pack.aptyVersion, version);
      assert.equal(pack.schemaVersion, 2);
      assert.ok(pack.retrieval.coverage, "calibrated coverage settings");
      const statuses = pack.cards.map((card) => card.status);
      assert.equal(statuses.filter((s) => s === "stub").length, 1);
      assert.equal(statuses.filter((s) => s === "routing").length, 1);
      assert.ok(pack.cards.every((card) => /DEMO/.test(card.title)));
      assert.ok(pack.chunks.every((chunk) => chunk.text.includes("FIXTURE")));
    }
  });

  it("passes every question of the synthetic edge-case set (FIXES.md 7.2), per version", () => {
    for (const [version, pack] of Object.entries(packs)) {
      const questions = readQuestions(
        readFileSync(demoQuestionsFile(version), "utf8"),
      );
      const categories = new Set(questions.map((q) => q.category));
      for (const category of [
        "paraphrase",
        "symptom-line",
        "collision",
        "stem",
        "synonym",
        "typo",
        "short",
        "multi",
        "network-file",
        "layer",
        "stub",
        "version",
        "not-covered-long",
        "not-covered-setting",
        "not-covered-domain",
        "how-to",
        "non-english",
      ]) {
        assert.ok(categories.has(category), `${version}: ${category}`);
      }
      const report = evaluate(core, pack, questions);
      assert.deepEqual(report.misses, [], version);
      assert.equal(report.recallAt3, 1, version);
      assert.equal(report.layerAccuracy, 1, version);
      assert.equal(report.notCoveredPrecision, 1, version);
      assert.equal(report.notCoveredRecall, 1, version);
      assert.ok(report.questions - report.covered >= 9, version);
    }
  });

  it("leaves the how-to and non-English questions to the responder, which declines them", async () => {
    const { isBareHowTo, isMostlyNonLatin } = await import(INTENT.href);
    for (const version of ["4.x", "5.x"]) {
      for (const q of readQuestions(
        readFileSync(demoQuestionsFile(version), "utf8"),
      )) {
        if (q.category === "how-to") assert.ok(isBareHowTo(q.q), q.id);
        if (q.category === "non-english")
          assert.ok(isMostlyNonLatin(q.q), q.id);
      }
    }
  });

  it("refuses to write inside the repository, and names a bad version", async () => {
    const errors = [];
    const err = (line) => errors.push(line);
    assert.equal(
      await run({
        argv: ["--out", join(REPO_ROOT, "demo.kbpack.json")],
        home,
        err,
      }),
      1,
    );
    assert.equal(await run({ argv: ["--version", "6.x"], home, err }), 1);
    assert.match(errors.join("\n"), /outside this repository/);
    assert.match(errors.join("\n"), /--version takes 4\.x or 5\.x/);
  });

  it("is still caught by check-no-kb-pack when someone copies it into a tree", () => {
    const tree = mkdtempSync(join(tmpdir(), "apty-tree-"));
    mkdirSync(join(tree, "docs"));
    writeFileSync(
      join(tree, "docs", "demo-copy.json"),
      readFileSync(join(home, "apty-kb", "apty-kb-DEMO-5.x.kbpack.json")),
    );
    assert.deepEqual(kbPackProblems(tree), [
      {
        path: join("docs", "demo-copy.json"),
        reason: "carries the KB pack kind marker",
      },
    ]);
    rmSync(tree, { recursive: true, force: true });
  });
});
