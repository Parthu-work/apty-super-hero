#!/usr/bin/env node
/**
 * A ratchet on explicit `any` (D4). Counts Biome's noExplicitAny findings
 * per file and fails when a file has more than its count in
 * tooling/scripts/any-baseline.json, or a file not in the baseline has
 * any. Counts may only go down: after removing some, run with --update.
 *
 * Usage: node tooling/scripts/check-any-baseline.mjs [--update]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = resolve(ROOT, "tooling/scripts/any-baseline.json");

export function countAny(root = ROOT) {
  let out;
  try {
    out = execFileSync(
      "npx",
      [
        "biome",
        "lint",
        "--only=suspicious/noExplicitAny",
        "--reporter=json",
        "--max-diagnostics=none",
        ".",
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    // Biome exits non-zero when it reports errors; the JSON is still on stdout.
    out = error.stdout;
  }
  const counts = {};
  for (const diagnostic of JSON.parse(out).diagnostics ?? []) {
    if (diagnostic.category !== "lint/suspicious/noExplicitAny") continue;
    const path = diagnostic.location?.path;
    const file = typeof path === "string" ? path : path?.file;
    if (file) counts[file] = (counts[file] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Files whose count rose above the baseline, or that are new. */
export function compareToBaseline(counts, baseline) {
  return Object.entries(counts)
    .filter(([file, count]) => count > (baseline[file] ?? 0))
    .map(([file, count]) => ({ file, count, allowed: baseline[file] ?? 0 }));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const counts = countAny();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(
      `✓ any-baseline.json updated: ${total} in ${Object.keys(counts).length} files`,
    );
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const over = compareToBaseline(counts, baseline);
    if (over.length > 0) {
      console.error(
        "Explicit `any` above the baseline (remove it, or type it):",
      );
      for (const { file, count, allowed } of over) {
        console.error(`  ${file}: ${count} (allowed ${allowed})`);
      }
      process.exitCode = 1;
    } else {
      console.log(`✓ ${total} explicit any, none above the baseline`);
    }
  }
}
