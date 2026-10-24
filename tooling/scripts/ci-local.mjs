#!/usr/bin/env node
/**
 * Runs CI locally: every `run:` step of .github/workflows/ci.yml, in order,
 * with the same command and working directory, and CI=true as GitHub sets
 * it. The steps are read from the workflow itself, so a step added to CI
 * runs here too. Like CI it stops at the first failing step, except that a
 * `continue-on-error: true` step (ci.yml has none today) is reported and the
 * run goes on. `uses:` steps (checkout, pnpm and Node
 * setup) are not run: use the Node and pnpm versions CI uses.
 *
 * Usage: node tooling/scripts/ci-local.mjs [--list] [--workflow <file>] [--root <dir>]
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function unquote(value) {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted ? quoted[2] : trimmed;
}

/**
 * The steps of a single-job workflow, in order: `{ name, uses, run,
 * workingDirectory, continueOnError }`. Reads only what ci.yml uses: one
 * `steps:` list, `key: value` lines and `run: |` blocks.
 */
export function parseWorkflowSteps(yaml) {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^\s*steps:\s*$/.test(line));
  if (start === -1) throw new Error("no steps: list in the workflow");
  const steps = [];
  let itemIndent = -1;
  let step;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (itemIndent !== -1 && indent < itemIndent) break;
    let content = line.trim();
    if (
      content.startsWith("- ") &&
      (itemIndent === -1 || indent === itemIndent)
    ) {
      itemIndent = indent;
      step = { continueOnError: false };
      steps.push(step);
      content = content.slice(2);
    } else if (indent !== itemIndent + 2) {
      continue;
    }
    const field = /^([\w-]+):\s?(.*)$/.exec(content);
    if (!field || !step) continue;
    const [, key, raw] = field;
    let value = raw;
    if (/^[|>][-+]?\s*$/.test(raw)) {
      const body = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextIndent = next.length - next.trimStart().length;
        if (next.trim() && nextIndent <= itemIndent + 2) break;
        body.push(next.trim());
        i++;
      }
      value = body.filter(Boolean).join("\n");
    }
    if (key === "name") step.name = unquote(value);
    else if (key === "uses") step.uses = unquote(value);
    else if (key === "run") step.run = value.trim();
    else if (key === "working-directory")
      step.workingDirectory = unquote(value);
    else if (key === "continue-on-error")
      step.continueOnError = unquote(value) === "true";
  }
  return steps;
}

/** The steps CI runs a command for, named by their command when they have no name. */
export function runSteps(steps) {
  return steps
    .filter((step) => step.run)
    .map((step) => ({ ...step, name: step.name ?? step.run }));
}

function main(argv) {
  const option = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = resolve(option("--root") ?? ROOT);
  const workflow = resolve(
    root,
    option("--workflow") ?? ".github/workflows/ci.yml",
  );
  const steps = runSteps(parseWorkflowSteps(readFileSync(workflow, "utf8")));

  if (argv.includes("--list")) {
    steps.forEach((step, i) => {
      const where = step.workingDirectory
        ? ` (in ${step.workingDirectory})`
        : "";
      const info = step.continueOnError ? " [informational]" : "";
      console.log(`${i + 1}. ${step.name}: ${step.run}${where}${info}`);
    });
    return 0;
  }

  const informationalFailures = [];
  for (const [i, step] of steps.entries()) {
    console.log(`\n▶ ${i + 1}/${steps.length} ${step.name}: ${step.run}`);
    const result = spawnSync(step.run, {
      cwd: resolve(root, step.workingDirectory ?? "."),
      shell: true,
      stdio: "inherit",
      env: { ...process.env, CI: "true" },
    });
    const status = result.status ?? 1;
    if (status === 0) continue;
    if (step.continueOnError) {
      informationalFailures.push(step.name);
      console.log(
        `  ${step.name} failed (exit ${status}); informational, as in CI.`,
      );
      continue;
    }
    console.error(
      `\n✗ ${step.name} failed (exit ${status}); later steps were not run, as in CI.`,
    );
    return status;
  }
  console.log(`\n✓ All ${steps.length} CI steps passed.`);
  if (informationalFailures.length > 0) {
    console.log(
      `  Informational steps that failed: ${informationalFailures.join(", ")}.`,
    );
  }
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
