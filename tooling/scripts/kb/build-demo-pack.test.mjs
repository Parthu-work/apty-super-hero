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
  loadBrowserRuntime,
  loadBuilt,
  readPack,
  readQuestions,
} from "./eval-kb.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

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
    const { isBareHowTo, isMostlyNonLatin } =
      await loadBrowserRuntime("kb/kb-intent.js");
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

  it("F10: names the package to build when its dist is missing", async () => {
    await assert.rejects(
      loadBuilt(
        new URL(
          "../../../packages/browser-runtime/dist/src/missing.js",
          import.meta.url,
        ),
        "@apty/browser-runtime",
      ),
      /^Error: Build @apty\/browser-runtime first \(npm run build\): ERR_MODULE_NOT_FOUND$/,
    );
    await assert.rejects(
      loadBrowserRuntime("kb/not-built-yet.js"),
      /Build @apty\/browser-runtime first \(npm run build\)/,
    );
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

describe("K21 reproductions on the demo packs", () => {
  const search = (versions, q) =>
    core
      .createKbIndexSet(versions.map((v) => packs[v]))
      .search(q, { onePerCard: true });
  const top = (result) => result.hits[0]?.chunk.pageId;

  it("F1: the setting guard leaves product and browser names alone", () => {
    for (const [q, pageId] of [
      ["DEMO balloon does not appear on the Admin Portal page", "4002"],
      ["DEMO hint text is cropped, the Service Worker shows nothing", "4007"],
      [
        "I turned on Developer Mode and the DEMO player freezes the page",
        "4003",
      ],
      [
        "DEMO hint cut off at the window edge although the DEMO Deep Scan option is off",
        "4007",
      ],
    ]) {
      const result = search(["4.x"], q);
      assert.equal(result.status, "ok", q);
      assert.equal(top(result), pageId, q);
    }
  });

  it("F1: the setting guard still refuses an invented setting", () => {
    for (const [q, phrase] of [
      ["where is the Widget Activation toggle", "Widget Activation"],
      ["turn on the Allowed Domains setting", "Allowed Domains"],
      ["the 'Smart Sync' option", "Smart Sync"],
    ]) {
      const result = search(["4.x"], q);
      assert.equal(result.reason, "unknown_setting", q);
      assert.deepEqual(result.missingPhrases, [phrase], q);
    }
  });

  it("F2: a stub needs the question's own words, not one shared generic word", () => {
    assert.notEqual(search(["4.x"], "widgt not showing").status, "stub");
    const analytics = search(
      ["4.x"],
      "DEMO analytics events missing in the dashboard",
    );
    assert.equal(analytics.status, "stub");
    assert.equal(analytics.card?.pageId, "4012");
  });

  it("F5: a short typo reaches its card, and off-topic questions stay not covered", () => {
    for (const q of [
      "DEMO baloon does not apear",
      "the balloon is not apearing on the DEMO field",
    ]) {
      const result = search(["4.x"], q);
      assert.equal(result.status, "ok", q);
      assert.equal(top(result), "4002", q);
    }
    const widget = search(["4.x"], "widgt not showing");
    assert.ok(
      widget.status === "not_covered" || top(widget) === "4006",
      `${widget.status} ${top(widget)}`,
    );
    for (const q of [
      "kubernetes pod CrashLoopBackOff",
      "how do I configure SAML SSO",
    ]) {
      for (const version of ["4.x", "5.x"]) {
        assert.equal(search([version], q).status, "not_covered", q);
      }
    }
  });

  it("F7: a synonym used in its ordinary sense does not pick the group's card", () => {
    const icon = search(["4.x"], "the help icon is gone");
    assert.ok(
      icon.status === "not_covered" || top(icon) === "4006",
      `${icon.status} ${top(icon)}`,
    );
    assert.notEqual(top(icon), "4010");
    for (const version of ["4.x", "5.x"]) {
      const again = search(
        [version],
        "I tried again and the DEMO balloon does not appear",
      );
      assert.notEqual(top(again), "2010", version);
      const button = search(
        [version],
        "the DEMO button on the form is disabled",
      );
      assert.ok(!["2007", "2012", "4010"].includes(top(button)), version);
    }
  });
});
