#!/usr/bin/env node
/**
 * Fails if a new, unreviewed "aipex"/"AIPex" reference shows up.
 *
 * Every name a user, a customer page, a log line, a CLI user or a package
 * consumer sees is an Apty name (R2, C1), and data stored under AIPex names
 * is no longer migrated (Part A). What is left is listed below: the
 * upstream fork's name where the README credits it, the screenshot link
 * host earlier versions wrote (still resolved), and two deprecated
 * apps/mcp-bridge env var fallbacks. Tokens are matched whole
 * and case-sensitively, so "[AIPex]" or "data-aipex-new" is caught even
 * though "AIPex" (the fork's name) is allowed; CODE_USES catches the name
 * used as code, which the allowed word would otherwise let through.
 *
 * apps/mcp-bridge's bin names, PID file and log prefixes used to be
 * allow-listed here too ("aipex-mcp-bridge" etc.) but were a real bug, not
 * an intentional contract: both READMEs told users to `npx -y
 * aipex-mcp-bridge` / `npm install -g aipex-mcp-bridge`, which resolves a
 * different, unrelated package on the public npm registry. Fixed by
 * renaming the bins to "apty-*" and documenting a local-build install
 * instead -- see DECISIONS.md.
 *
 * Usage: node tooling/scripts/check-branding.mjs [<root>] [--verbose]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const ROOT =
  args.find((arg) => !arg.startsWith("--")) ??
  new URL("../../", import.meta.url).pathname;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".md",
  ".json",
]);

/** History and saved prompts describe the old names on purpose. */
const SKIP_PATHS = [
  "CHANGELOG.md",
  "DECISIONS.md",
  "REVIEW.md",
  `docs${sep}development${sep}STATUS_HISTORY.md`,
  `docs${sep}archive${sep}`,
  `docs${sep}tasks${sep}`,
  // This file's own lists, and check-mcp-bridge-docs.mjs's pattern for the
  // wrong upstream package.
  `tooling${sep}scripts${sep}`,
];

/** Tokens allowed exactly as written, each with why it is still read. */
const ALLOWED_TOKENS = new Set([
  // The upstream fork, by name: the README credit, and tests that check an
  // old name is gone or refused.
  "aipex",
  "AIPex",
  // The screenshot link host earlier versions wrote (aipex-screenshot.invalid),
  // still resolved by @apty/ui's resolveScreenshotUrls; never fetched.
  "aipex-screenshot",
  // apps/mcp-bridge's deprecated names for APTY_WS_URL and
  // APTY_CONNECT_TIMEOUT, read for one release when the new name is unset.
  "AIPEX_WS_URL",
  "AIPEX_CONNECT_TIMEOUT",
]);

/** Allowed anywhere inside a token (URLs and long identifiers). */
const ALLOWED_PARTS = [
  // github.com/AIPexStudio/AIPex, the fork's origin.
  "AIPexStudio",
  // "never run this" warnings naming the wrong upstream npm package.
  "aipex-mcp-bridge",
];

/**
 * The fork's name used as code (the class @apty/agent-core renamed to
 * AptyAgent, or its log prefix), which "AIPex" being allowed would miss.
 */
const CODE_USES = [
  /\bAIPex\s*\./,
  /\b(?:class|new|extends|typeof|instanceof)\s+AIPex\b/,
  /[:|<{,]\s*AIPex\b/,
  /["'`]AIPex["'`]/,
];

const TOKEN = /[\w$@:[\]'*-]*aipex[\w$@:[\]'*-]*/gi;

function isAllowedToken(raw) {
  const token = raw
    .replace(/^['*:-]+/, "")
    .replace(/'s$/, "")
    .replace(/['*:-]+$/, "");
  return (
    ALLOWED_TOKENS.has(token) ||
    ALLOWED_PARTS.some((part) => token.includes(part))
  );
}

/** @param {string} dir */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

const findings = [];

for (const file of walk(ROOT)) {
  const path = relative(ROOT, file);
  if (file.endsWith("pnpm-lock.yaml")) continue;
  if (SKIP_PATHS.some((skip) => path === skip || path.startsWith(skip))) {
    continue;
  }
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!/aipex/i.test(content)) continue;

  content.split("\n").forEach((line, idx) => {
    const unknown = (line.match(TOKEN) ?? []).filter(
      (token) => !isAllowedToken(token),
    );
    if (unknown.length > 0 || CODE_USES.some((use) => use.test(line))) {
      findings.push({ file: path, line: idx + 1, text: line.trim() });
    }
  });
}

if (findings.length > 0) {
  console.error(
    `\n✗ Found ${findings.length} unreviewed "aipex" reference(s) not covered by the allowlist in tooling/scripts/check-branding.mjs:\n`,
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}: ${f.text}`);
  }
  console.error(
    "\nIf this reference is real branding debt, fix it. If it's a legitimate\n" +
      "new data/behavior contract that must stay stable, add it to\n" +
      "ALLOWED_TOKENS in tooling/scripts/check-branding.mjs and explain why.\n",
  );
  process.exit(1);
} else {
  if (verbose) console.log("Scanned for stray AIPex branding.");
  console.log("✓ No unreviewed AIPex branding found.");
}
