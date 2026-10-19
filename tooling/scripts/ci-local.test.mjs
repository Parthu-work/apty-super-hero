import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseWorkflowSteps, runSteps } from "./ci-local.mjs";

const SCRIPT = fileURLToPath(new URL("./ci-local.mjs", import.meta.url));
const CI_YML = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)),
  "utf8",
);

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("the steps read from ci.yml", () => {
  const steps = runSteps(parseWorkflowSteps(CI_YML));

  it("are every run: step in the workflow, in order", () => {
    const runLines = [...CI_YML.matchAll(/^\s*(?:- )?run:\s*(.+)$/gm)].map(
      (match) => match[1].trim(),
    );
    assert.deepEqual(
      steps.map((step) => step.run),
      runLines,
    );
  });

  it("include the coverage of security-critical modules, after the tests and before the build", () => {
    const names = steps.map((step) => step.name);
    const coverage = names.indexOf("Coverage of security-critical modules");
    assert.notEqual(coverage, -1);
    assert.equal(steps[coverage].run, "npm run test:coverage");
    assert.ok(names.indexOf("Test") < coverage);
    assert.ok(coverage < names.indexOf("Build"));
  });

  it("keep each step's working directory and leave only the dependency check informational", () => {
    const bridge = steps.filter(
      (s) => s.workingDirectory === "apps/mcp-bridge",
    );
    assert.deepEqual(
      bridge.map((s) => s.run),
      [
        "pnpm install --ignore-workspace",
        "pnpm audit --prod --ignore-workspace",
      ],
    );
    assert.deepEqual(
      steps.filter((s) => s.continueOnError).map((s) => s.run),
      ["npm run lint:dependencies"],
    );
  });

  it("leave out the uses: steps, which set up the runner", () => {
    const all = parseWorkflowSteps(CI_YML);
    assert.ok(all.some((step) => step.uses?.startsWith("actions/checkout@")));
    assert.ok(steps.every((step) => step.uses === undefined));
  });
});

describe("running the steps", () => {
  function workflow(yaml) {
    const root = mkdtempSync(join(tmpdir(), "ci-local-"));
    dirs.push(root);
    writeFileSync(join(root, "ci.yml"), yaml);
    return spawnSync(
      process.execPath,
      [SCRIPT, "--root", root, "--workflow", "ci.yml"],
      { encoding: "utf8", env: { ...process.env, CI: "" } },
    );
  }

  const steps = (...lines) =>
    ["jobs:", "  ci:", "    steps:", ...lines.map((l) => `      ${l}`)].join(
      "\n",
    );

  it("stops at the first failing step, as CI does, and exits with its code", () => {
    const result = workflow(
      steps(
        "- uses: actions/checkout@v4",
        "- name: First",
        "  run: node -e \"console.log('first ran')\"",
        "- name: Failing",
        '  run: node -e "process.exit(3)"',
        "- name: Never",
        "  run: node -e \"console.log('never ran')\"",
      ),
    );
    assert.equal(result.status, 3);
    assert.match(result.stdout, /first ran/);
    assert.doesNotMatch(result.stdout, /never ran/);
    assert.match(result.stderr, /Failing failed \(exit 3\)/);
  });

  it("reports a failing continue-on-error step and goes on, with CI=true set", () => {
    const result = workflow(
      steps(
        "- name: Informational",
        '  run: node -e "process.exit(1)"',
        "  continue-on-error: true",
        "- name: Sees CI",
        "  run: node -e \"console.log('CI=' + process.env.CI)\"",
      ),
    );
    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /Informational failed \(exit 1\); informational/,
    );
    assert.match(result.stdout, /CI=true/);
    assert.match(result.stdout, /All 2 CI steps passed/);
  });
});
