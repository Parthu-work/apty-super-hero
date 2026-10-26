#!/usr/bin/env node
/**
 * A ratchet on hard-coded colours and sizes in the extension's and
 * @apty/ui's source: Tailwind palette classes (text-green-600), hex,
 * rgb()/hsl() literals, arbitrary text sizes (text-[11px]), text-base and
 * larger, font-bold/extrabold/black, uppercase and tracking-*. Screens use
 * the design tokens and the type scale instead (tailwind.css).
 *
 * Counts each rule per file in non-test .ts and .tsx files, comments
 * excluded, and fails when a count is above tooling/scripts/
 * design-tokens-baseline.json. Without a baseline file nothing is allowed.
 * `--update` lowers an existing baseline to the current counts; it never
 * raises a count and never creates the file. The content script's glow overlay is exempt: it is drawn into the
 * host page, where the extension's CSS variables do not exist.
 *
 * Usage: node tooling/scripts/check-design-tokens.mjs
 *          [--root <dir>] [--baseline <file>] [--update]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCANNED = ["apps/browser-extension/src", "packages/ui/src"];
const EXEMPT = new Set([
  "apps/browser-extension/src/entrypoints/content/index.tsx",
]);

const PALETTE =
  "red|green|blue|yellow|orange|amber|emerald|lime|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";

export const RULES = {
  palette: new RegExp(
    `\\b[a-z]+(?:-[a-z]+)*-(?:${PALETTE})-(?:50|[1-9]00|950)\\b`,
    "g",
  ),
  hex: /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
  "rgb-hsl": /\b(?:rgba?|hsla?)\(/g,
  "arbitrary-text-size": /\btext-\[\d+(?:\.\d+)?(?:px|rem|em)\]/g,
  "large-text-size": /\btext-(?:base|lg|xl|[2-9]xl)\b/g,
  "heavy-weight": /\bfont-(?:bold|extrabold|black)\b/g,
  uppercase: /\buppercase\b/g,
  tracking:
    /\btracking-(?:tighter|tight|normal|wide|wider|widest|\[[^\]\s]+\])/g,
};

/** Source without comments; a `//` right after a colon (a URL) stays. */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

export function countRules(source) {
  const code = stripComments(source);
  const counts = {};
  for (const [rule, pattern] of Object.entries(RULES)) {
    const found = code.match(pattern)?.length ?? 0;
    if (found > 0) counts[rule] = found;
  }
  return counts;
}

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      yield* sourceFiles(path);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      yield path;
    }
  }
}

/** { rule: { file: count } }, files relative to `root`, sorted. */
export function scan(root) {
  const byRule = {};
  for (const dir of SCANNED) {
    for (const path of sourceFiles(join(root, dir))) {
      const file = relative(root, path).split("\\").join("/");
      if (EXEMPT.has(file)) continue;
      for (const [rule, count] of Object.entries(
        countRules(readFileSync(path, "utf8")),
      )) {
        byRule[rule] ??= {};
        byRule[rule][file] = count;
      }
    }
  }
  return Object.fromEntries(
    Object.keys(RULES)
      .filter((rule) => byRule[rule])
      .map((rule) => [
        rule,
        Object.fromEntries(
          Object.entries(byRule[rule]).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ]),
  );
}

/** Every (rule, file) whose count is above what the baseline allows. */
export function overBaseline(counts, baseline) {
  const over = [];
  for (const [rule, files] of Object.entries(counts)) {
    for (const [file, count] of Object.entries(files)) {
      const allowed = baseline[rule]?.[file] ?? 0;
      if (count > allowed) over.push({ rule, file, count, allowed });
    }
  }
  return over;
}

function total(counts) {
  return Object.values(counts)
    .flatMap((files) => Object.values(files))
    .reduce((a, b) => a + b, 0);
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    option("--root") ?? fileURLToPath(new URL("../..", import.meta.url)),
  );
  const baselinePath = resolve(
    option("--baseline") ??
      join(root, "tooling/scripts/design-tokens-baseline.json"),
  );
  const counts = scan(root);
  const baseline = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, "utf8"))
    : {};
  const over = overBaseline(counts, baseline);

  if (over.length > 0) {
    console.error(
      "Hard-coded colours or sizes above the baseline. Use the design tokens and the type scale (apps/browser-extension/src/styles/tailwind.css):",
    );
    for (const { rule, file, count, allowed } of over) {
      console.error(`  ${rule}: ${file}: ${count} (allowed ${allowed})`);
    }
    process.exitCode = 1;
  } else if (process.argv.includes("--update") && existsSync(baselinePath)) {
    writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(
      `✓ design-tokens-baseline.json updated: ${total(counts)} hard-coded colours and sizes`,
    );
  } else if (total(counts) === 0) {
    console.log("✓ no hard-coded colours or sizes");
  } else {
    console.log(
      `✓ ${total(counts)} hard-coded colours and sizes, none above the baseline`,
    );
  }
}
