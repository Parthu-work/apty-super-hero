/**
 * KB-RAG K29 P1: the KB workflows' inputs check, moved out of the inline
 * shell. A scheduled run before the pipeline is set up skips quietly; a
 * manual run, or a scheduled run once KB_PACKS_ENABLED is on, fails naming
 * what is missing, never printing a value.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  checkHealthInputs,
  checkPackInputs,
  NOT_SET_UP_NOTICE,
  run,
  shouldRun,
} from "./pipeline-inputs.mjs";

const SECRET = "FIXTURE-secret-value-never-printed";
const FULL = {
  CONFLUENCE_EMAIL: `kb@${SECRET}.invalid`,
  CONFLUENCE_TOKEN: SECRET,
  KB_CI_SIGNING_KEY: SECRET,
  KB_PUBLISH_TOKEN: SECRET,
  KB_PUBLISH_URL_4X: `https://${SECRET}.invalid/4x.json`,
  KB_PUBLISH_URL_5X: `https://${SECRET}.invalid/5x.json`,
};

function runCli(argv, env) {
  const lines = [];
  const outputs = {};
  const code = run({
    argv,
    env,
    out: (line) => lines.push(line),
    setOutput: (name, value) => {
      outputs[name] = value;
    },
  });
  return { code, text: lines.join("\n"), outputs };
}

describe("pipeline-inputs: the KB_PACKS_ENABLED switch", () => {
  it("a scheduled run with the switch unset skips with the notice and succeeds", () => {
    assert.deepEqual(shouldRun({ event: "schedule", env: {} }), {
      run: false,
      notice: NOT_SET_UP_NOTICE,
    });
    const { code, text, outputs } = runCli(["gate"], {
      GITHUB_EVENT_NAME: "schedule",
    });
    assert.equal(code, 0);
    assert.equal(outputs.run, "false");
    assert.match(
      text,
      /^::notice title=KB packs::KB packs are not set up yet; set KB_PACKS_ENABLED to 1 after the steps in KB_PACK_DELIVERY\.md$/m,
    );
  });

  it("a scheduled run with the switch on, and every manual run, goes ahead", () => {
    for (const [event, env] of [
      ["schedule", { KB_PACKS_ENABLED: "1" }],
      ["schedule", { KB_PACKS_ENABLED: "true" }],
      ["workflow_dispatch", {}],
      ["workflow_dispatch", { KB_PACKS_ENABLED: "0" }],
    ]) {
      assert.equal(
        shouldRun({ event, env }).run,
        true,
        `${event} ${JSON.stringify(env)}`,
      );
    }
    assert.equal(
      shouldRun({ event: "schedule", env: { KB_PACKS_ENABLED: "0" } }).run,
      false,
    );
    const { code, outputs } = runCli(["gate"], {
      GITHUB_EVENT_NAME: "workflow_dispatch",
    });
    assert.equal(code, 0);
    assert.equal(outputs.run, "true");
  });
});

describe("pipeline-inputs: the pack job's inputs", () => {
  it("a manual run with missing inputs fails with their names only", () => {
    const env = {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      CONFLUENCE_EMAIL: FULL.CONFLUENCE_EMAIL,
      KB_PUBLISH_URL_4X: FULL.KB_PUBLISH_URL_4X,
    };
    const { code, text } = runCli(["pack", "--version", "5.x"], env);
    assert.equal(code, 1);
    assert.match(
      text,
      /^::error::Missing: CONFLUENCE_TOKEN KB_CI_SIGNING_KEY KB_PUBLISH_TOKEN KB_PUBLISH_URL_5X\. Set them as described in docs\/release\/KB_PACK_DELIVERY\.md\.$/m,
    );
    assert.ok(!text.includes(SECRET), "no value printed");
  });

  it("an enabled scheduled run with missing inputs fails with their names only", () => {
    const env = {
      GITHUB_EVENT_NAME: "schedule",
      KB_PACKS_ENABLED: "1",
      ...FULL,
      KB_PUBLISH_TOKEN: "",
    };
    const { code, text } = runCli(["pack", "--version", "4.x"], env);
    assert.equal(code, 1);
    assert.match(text, /::error::Missing: KB_PUBLISH_TOKEN\./);
    assert.ok(!text.includes(SECRET), "no value printed");
  });

  it("every input set gives the outputs the later steps read, and no value", () => {
    const { code, text, outputs } = runCli(["pack", "--version", "4.x"], {
      GITHUB_EVENT_NAME: "schedule",
      KB_PACKS_ENABLED: "1",
      ...FULL,
    });
    assert.equal(code, 0);
    assert.deepEqual(outputs, {
      source: "confluence",
      publish_url_name: "KB_PUBLISH_URL_4X",
      has_host: "true",
    });
    assert.ok(!text.includes(SECRET));
  });

  it("a dry run never fails: the demo builder stands in without Confluence", () => {
    const result = checkPackInputs({
      version: "5.x",
      env: { KB_PUBLISH_DRY_RUN: "1" },
    });
    assert.deepEqual(result, {
      missing: [],
      outputs: {
        source: "demo",
        publish_url_name: "KB_PUBLISH_URL_5X",
        has_host: "false",
      },
    });
    assert.equal(
      checkPackInputs({
        version: "5.x",
        env: { KB_PUBLISH_DRY_RUN: "1", ...FULL },
      }).outputs.source,
      "confluence",
    );
  });

  it("rejects a version other than 4.x and 5.x", () => {
    const { code, text } = runCli(["pack", "--version", "6.x"], FULL);
    assert.equal(code, 2);
    assert.match(text, /--version takes 4\.x or 5\.x/);
  });
});

describe("pipeline-inputs: the health job's inputs", () => {
  it("names the publish token and the pack URLs it needs", () => {
    assert.deepEqual(checkHealthInputs({ env: {} }).missing, [
      "KB_PUBLISH_TOKEN",
      "KB_PUBLISH_URL_4X",
      "KB_PUBLISH_URL_5X",
    ]);
    const { code, text } = runCli(["health"], {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      KB_PUBLISH_URL_4X: FULL.KB_PUBLISH_URL_4X,
    });
    assert.equal(code, 1);
    assert.match(
      text,
      /::error::Missing: KB_PUBLISH_TOKEN KB_PUBLISH_URL_5X\./,
    );
    assert.ok(!text.includes(SECRET));
    assert.equal(runCli(["health"], FULL).code, 0);
  });
});

const workflowText = (name) =>
  readFileSync(
    new URL(`../../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );

describe("the KB workflows use the switch", () => {
  for (const [name, job, check] of [
    ["kb-packs.yml", "pack", 'pack --version "$VERSION"'],
    ["kb-pack-health.yml", "age", "health"],
  ]) {
    it(`${name} gates its ${job} job on the switch and checks its inputs with the script`, () => {
      const text = workflowText(name);
      assert.match(
        text,
        /KB_PACKS_ENABLED: \$\{\{ vars\.KB_PACKS_ENABLED \}\}/,
      );
      assert.match(
        text,
        /node tooling\/scripts\/kb\/pipeline-inputs\.mjs gate/,
      );
      assert.ok(
        text.includes(`node tooling/scripts/kb/pipeline-inputs.mjs ${check}`),
        `${name} checks its inputs with the script`,
      );
      const jobStart = text.indexOf(`\n  ${job}:\n`);
      assert.ok(jobStart > 0);
      assert.match(
        text.slice(jobStart, jobStart + 400),
        /\n {4}if: needs\.plan\.outputs\.run == 'true'\n/,
      );
      assert.ok(!/missing\+=/.test(text), "no inline inputs check left");
    });

    it(`${name} closes the kb-pipeline issue on its first green run`, () => {
      const text = workflowText(name);
      const start = text.indexOf("\n  recover:\n");
      assert.ok(start > 0, "a recover job");
      const recover = text.slice(start);
      assert.match(
        recover,
        /\n {4}if: success\(\) && needs\.plan\.outputs\.run == 'true'\n/,
      );
      assert.match(recover, /\n {6}issues: write\n/);
      assert.match(recover, /recoverForRun\(\{ github, context, workflow: /);
      assert.ok(!recover.includes("secrets."), "no secret in the recover job");
    });
  }
});
