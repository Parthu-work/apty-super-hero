#!/usr/bin/env node
/**
 * Fails when a test is skipped without saying why. Every `.skip(` or
 * `.skipIf(` on a describe/it/test/suite in a test file needs a
 * `// skip-reason: <why>` comment on the same line or the line above.
 *
 * Usage: node tooling/scripts/check-test-skips.mjs [root]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
]);
const TEST_FILE = /\.(test|spec|e2e\.test)\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_CALL = /\b(?:describe|it|test|suite)\.skip(?:If)?\s*\(/;
const REASON = /\/\/\s*skip-reason:\s*\S/;

function* testFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* testFiles(full);
    else if (TEST_FILE.test(entry)) yield full;
  }
}

/** Lines (1-based) of `.skip(` calls in `source` with no skip-reason on that line or the one above. */
export function unexplainedSkips(source) {
  const lines = source.split("\n");
  const found = [];
  lines.forEach((line, i) => {
    if (!SKIP_CALL.test(line)) return;
    if (REASON.test(line) || REASON.test(lines[i - 1] ?? "")) return;
    found.push(i + 1);
  });
  return found;
}

export function checkTestSkips(root) {
  const problems = [];
  for (const file of testFiles(root)) {
    for (const line of unexplainedSkips(readFileSync(file, "utf8"))) {
      problems.push(`${relative(root, file)}:${line}`);
    }
  }
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    process.argv[2] ?? new URL("../../", import.meta.url).pathname,
  );
  const problems = checkTestSkips(root);
  if (problems.length > 0) {
    console.error("Skipped tests without a `// skip-reason: <why>` comment:");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("✓ every skipped test says why");
  }
}
