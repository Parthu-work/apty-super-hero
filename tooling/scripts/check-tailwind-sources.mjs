#!/usr/bin/env node
/**
 * Guards against the WP16 regression: apps/browser-extension/src/styles/
 * tailwind.css had `@source` lines pointing at directories that did not
 * exist (an old `aipex-react`/`core` layout), so Tailwind silently never
 * scanned packages/ui/src for class names — 98% of the utility classes
 * used there were missing from the built stylesheet, with no build error.
 *
 * Checks, in order:
 *   (a) every `@source` path in tailwind.css resolves to a real directory;
 *   (b) every workspace package that has TSX using `className` is covered
 *       by at least one `@source` path (as a path prefix);
 *   (c) after a build, at least 99% of the utility-class-looking tokens
 *       used in the covered source directories exist in the built CSS,
 *       against an explicit allow-list for tokens that are deliberately
 *       assembled at runtime (so can't be found by static scanning).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXT_DIR = join(ROOT, "apps/browser-extension");
const CSS_PATH = join(EXT_DIR, "src/styles/tailwind.css");
const DIST_ASSETS_DIR = join(EXT_DIR, "dist/assets");

// Tokens found by the static scan that are not Tailwind utility classes, so
// they are never expected to appear in the built CSS. Add an entry here —
// with a comment saying why — rather than weakening the 99% gate.
const DYNAMIC_TOKEN_ALLOWLIST = new Set([
  // Status/tone/orientation enum values compared inside a `cn(...)`
  // condition or passed to a helper (e.g. `toneTextClass("danger")`,
  // `orientation === "horizontal"`), not class names themselves.
  "application",
  "confirmed",
  "danger",
  "done",
  "error",
  "ghost",
  "horizontal",
  "log",
  "neutral",
  "not_confirmed",
  "page",
  "popper",
  "skipped",
  // @tailwindcss/typography's "not-prose" — used defensively in a few
  // components, but the typography plugin isn't installed, so neither
  // `prose` nor `not-prose` currently do anything (verified: bare `prose`
  // is never applied anywhere in this codebase or by Streamdown). Kept
  // as-is rather than pulling in a new plugin dependency for a class that
  // has no visible effect either way; see docs/audit/UI_AUDIT.md.
  "not-prose",
]);

const errors = [];
const warnings = [];

function readSourceDirectives(cssPath) {
  const text = readFileSync(cssPath, "utf8");
  const matches = [...text.matchAll(/@source\s+"([^"]+)"/g)];
  return matches.map((m) => m[1]);
}

// --- (a) every @source path exists -----------------------------------------

if (!existsSync(CSS_PATH)) {
  console.error(`✗ tailwind.css not found at ${CSS_PATH}`);
  process.exit(1);
}

const cssDir = dirname(CSS_PATH);
const sourcePaths = readSourceDirectives(CSS_PATH);

if (sourcePaths.length === 0) {
  errors.push("tailwind.css has no @source directives at all");
}

const resolvedSourceDirs = [];
for (const raw of sourcePaths) {
  const full = resolve(cssDir, raw);
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    errors.push(`@source "${raw}" resolves to ${full}, which does not exist`);
  } else {
    resolvedSourceDirs.push(full);
  }
}

// --- (b) every workspace package with TSX+className is covered ------------

function findTsxDirsWithClassName(dir, results = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findTsxDirsWithClassName(full, results);
    } else if (entry.name.endsWith(".tsx")) {
      const text = readFileSync(full, "utf8");
      if (text.includes("className")) {
        results.push(full);
      }
    }
  }
  return results;
}

const candidatePackageSrcDirs = [
  join(ROOT, "apps/browser-extension/src"),
  ...readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(ROOT, "packages", e.name, "src")),
].filter((d) => existsSync(d));

for (const srcDir of candidatePackageSrcDirs) {
  const filesWithClassName = findTsxDirsWithClassName(srcDir);
  if (filesWithClassName.length === 0) continue;
  const covered = resolvedSourceDirs.some(
    (sourceDir) =>
      srcDir === sourceDir ||
      srcDir.startsWith(`${sourceDir}${"/"}`) ||
      sourceDir.startsWith(`${srcDir}${"/"}`),
  );
  if (!covered) {
    errors.push(
      `${relative(ROOT, srcDir)} has ${filesWithClassName.length} .tsx file(s) using className, but no @source path covers it`,
    );
  }
}

// --- (c) after a build, >=99% of used utility tokens are in the built CSS -

const CLASS_TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:/_.\-[\]%]*$/;

/**
 * Find the source text of every `className="..."` / `className={...}` in a
 * file, so token extraction only looks inside those spans rather than every
 * quoted string in the file (comments, i18n copy, URLs, etc.).
 */
function extractClassNameSpans(text) {
  const spans = [];
  const attrPattern = /className\s*=\s*/g;
  let match = attrPattern.exec(text);
  while (match !== null) {
    const start = attrPattern.lastIndex;
    const opener = text[start];
    if (opener === '"' || opener === "'") {
      const end = text.indexOf(opener, start + 1);
      if (end !== -1) spans.push(text.slice(start, end));
    } else if (opener === "{") {
      let depth = 1;
      let i = start + 1;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      spans.push(text.slice(start + 1, i - 1));
    }
    match = attrPattern.exec(text);
  }
  return spans;
}

function extractClassTokens(dir) {
  const tokens = new Set();
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(tsx|ts)$/.test(entry.name)) {
        const text = readFileSync(full, "utf8");
        for (const span of extractClassNameSpans(text)) {
          for (const m of span.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
            // Strip `${...}` interpolations from template-literal matches
            // so the identifiers/expressions inside them aren't mistaken
            // for class-name tokens.
            const withoutInterpolation = m[2].replace(/\$\{[^}]*\}/g, " ");
            for (const token of withoutInterpolation.split(/\s+/)) {
              if (
                token &&
                CLASS_TOKEN_PATTERN.test(token) &&
                /[a-z]/.test(token)
              ) {
                tokens.add(token);
              }
            }
          }
        }
      }
    }
  };
  walk(dir);
  return tokens;
}

// Characters Tailwind escapes with a backslash in generated CSS selectors
// (e.g. `data-[state=active]:bg-background` becomes
// `.data-\[state\=active\]\:bg-background`).
const CSS_ESCAPED_CHARS = new Set([":", "/", "[", "]", ".", "%", "="]);
const REGEX_META_CHARS = new Set([
  "\\",
  "^",
  "$",
  "*",
  "+",
  "?",
  "(",
  ")",
  "{",
  "}",
  "|",
]);

function tokenToCssSearchPattern(token) {
  // Build a regex that matches the token either verbatim or with an
  // optional backslash inserted before each CSS-escaped character, so it
  // matches Tailwind's escaped selector form in the built CSS.
  let pattern = "";
  for (const ch of token) {
    if (CSS_ESCAPED_CHARS.has(ch)) {
      pattern += `\\\\?\\${ch}`;
    } else if (REGEX_META_CHARS.has(ch)) {
      pattern += `\\${ch}`;
    } else {
      pattern += ch;
    }
  }
  return new RegExp(pattern);
}

if (existsSync(DIST_ASSETS_DIR)) {
  const cssFiles = readdirSync(DIST_ASSETS_DIR).filter((f) =>
    f.endsWith(".css"),
  );
  if (cssFiles.length === 0) {
    warnings.push(
      "no built CSS found under dist/assets — skipping the utility-coverage check (run `pnpm build` first)",
    );
  } else {
    const builtCss = cssFiles
      .map((f) => readFileSync(join(DIST_ASSETS_DIR, f), "utf8"))
      .join("\n");

    // Also assert no remote URL leaked into the built CSS (WP16 item 3).
    const remoteUrlMatch = builtCss.match(/https?:\/\/[^\s"')]+/);
    if (remoteUrlMatch) {
      errors.push(
        `built CSS contains a remote URL (${remoteUrlMatch[0]}) — fonts and other assets must be bundled locally`,
      );
    }

    const allTokens = new Set();
    for (const srcDir of candidatePackageSrcDirs) {
      for (const token of extractClassTokens(srcDir)) {
        allTokens.add(token);
      }
    }

    const missing = [];
    for (const token of allTokens) {
      if (DYNAMIC_TOKEN_ALLOWLIST.has(token)) continue;
      if (!tokenToCssSearchPattern(token).test(builtCss)) {
        missing.push(token);
      }
    }

    const total = allTokens.size;
    const found = total - missing.length;
    const coverage = total === 0 ? 1 : found / total;

    if (coverage < 0.99) {
      errors.push(
        `only ${(coverage * 100).toFixed(1)}% of ${total} scanned utility-class tokens were found in the built CSS (need >= 99%)`,
      );
      errors.push(
        `missing tokens (${missing.length}):\n  ${missing.sort().join("\n  ")}`,
      );
    } else {
      console.log(
        `✓ ${(coverage * 100).toFixed(1)}% of ${total} scanned utility-class tokens found in the built CSS`,
      );
    }
  }
}

for (const warning of warnings) {
  console.warn(`⚠ ${warning}`);
}

if (errors.length > 0) {
  console.error("✗ Tailwind @source check failed:\n");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log("✓ Tailwind @source check passed");
