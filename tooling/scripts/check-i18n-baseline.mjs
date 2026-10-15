#!/usr/bin/env node
/**
 * A ratchet on user-visible English written straight into JSX instead of
 * en.json/zh.json (R8). Counts, per .tsx file in packages/ui/src and
 * apps/browser-extension/src (tests excluded): JSX text with a letter in it,
 * string literals that are a JSX child (`{"Not run"}`), and string values of
 * user-visible attributes (aria-label, title, placeholder, alt, label). Fails
 * when a file has more than its count in tooling/scripts/i18n-baseline.json,
 * or a file not in the baseline has any. After moving strings into the
 * locale files, run with --update.
 *
 * Usage: node tooling/scripts/check-i18n-baseline.mjs [--update]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASELINE = resolve(ROOT, "tooling/scripts/i18n-baseline.json");
const SCAN_DIRS = ["packages/ui/src", "apps/browser-extension/src"];
const VISIBLE_ATTRIBUTES = new Set([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "label",
]);
const HAS_LETTER = /\p{L}/u;

export function countHardcodedStrings(source, fileName) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let count = 0;
  const visit = (node) => {
    if (ts.isJsxText(node) && HAS_LETTER.test(node.text)) {
      count++;
    } else if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression &&
      ts.isStringLiteralLike(node.expression) &&
      HAS_LETTER.test(node.expression.text)
    ) {
      count++;
    } else if (
      ts.isJsxAttribute(node) &&
      VISIBLE_ATTRIBUTES.has(node.name.getText(file)) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      HAS_LETTER.test(node.initializer.text)
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

function* tsxFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules" && entry !== "dist") yield* tsxFiles(full);
    } else if (entry.endsWith(".tsx") && !/\.test\.tsx$/.test(entry)) {
      yield full;
    }
  }
}

export function countRepo(root = ROOT) {
  const counts = {};
  for (const dir of SCAN_DIRS) {
    for (const file of tsxFiles(resolve(root, dir))) {
      const count = countHardcodedStrings(readFileSync(file, "utf8"), file);
      if (count > 0) counts[relative(root, file)] = count;
    }
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
  const counts = countRepo();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes("--update")) {
    writeFileSync(BASELINE, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(
      `✓ i18n-baseline.json updated: ${total} in ${Object.keys(counts).length} files`,
    );
  } else {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    const over = compareToBaseline(counts, baseline);
    if (over.length > 0) {
      console.error(
        "Hard-coded UI text above the baseline (move it to en.json/zh.json):",
      );
      for (const { file, count, allowed } of over) {
        console.error(`  ${file}: ${count} (allowed ${allowed})`);
      }
      process.exitCode = 1;
    } else {
      console.log(`✓ ${total} hard-coded UI strings, none above the baseline`);
    }
  }
}
