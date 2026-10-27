#!/usr/bin/env node
/**
 * A guard against hard-coded colours and sizes in the extension's and
 * @apty/ui's source: Tailwind palette classes (text-green-600), hex,
 * rgb()/hsl() literals, arbitrary text sizes (text-[11px]), text-base and
 * larger, font-bold/extrabold/black, uppercase and tracking-*. Screens use
 * the design tokens and the type scale instead (tailwind.css).
 *
 * Counts each rule per file in non-test .ts and .tsx files, comments
 * excluded, and fails on any of them: nothing is tolerated. Files drawn
 * outside the extension's stylesheet are exempt (EXEMPT).
 *
 * Usage: node tooling/scripts/check-design-tokens.mjs [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCANNED = ["apps/browser-extension/src", "packages/ui/src"];
/**
 * Drawn where the extension's stylesheet and CSS variables do not exist:
 * the content script's overlay, the fake mouse it renders and the capture
 * outline it injects all live in the host page, and Chrome draws the
 * toolbar badge from a colour string.
 */
const EXEMPT = new Set([
  "apps/browser-extension/src/entrypoints/content/index.tsx",
  "apps/browser-extension/src/entrypoints/content/element-capture.ts",
  "packages/ui/src/components/fake-mouse/fake-mouse.tsx",
  "packages/ui/src/components/fake-mouse/types.ts",
  "apps/browser-extension/src/entrypoints/background/mcp-bridge.ts",
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
  const found = Object.entries(scan(root)).flatMap(([rule, files]) =>
    Object.entries(files).map(([file, count]) => ({ rule, file, count })),
  );

  if (found.length > 0) {
    console.error(
      "Hard-coded colours or sizes. Use the design tokens and the type scale (apps/browser-extension/src/styles/tailwind.css):",
    );
    for (const { rule, file, count } of found) {
      console.error(`  ${rule}: ${file}: ${count}`);
    }
    process.exitCode = 1;
  } else {
    console.log("✓ no hard-coded colours or sizes");
  }
}
