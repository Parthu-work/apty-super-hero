#!/usr/bin/env node
/**
 * Fails if a new, unreviewed "aipex"/"AIPex" reference shows up.
 *
 * The repo intentionally keeps a small, fixed set of "aipex"-branded
 * identifiers that are real data/behavior contracts, not cosmetic branding:
 * chrome.storage/IndexedDB keys and DB names, DOM attribute/class names,
 * cross-context message action strings, the AIPex class name in
 * @apty/agent-core, and two apps/mcp-bridge env var names kept as-is from
 * the upstream fork's raw CLI protocol. Renaming any of those would be a
 * behavior change, not a branding fix -- see DECISIONS.md and the git
 * history of this script's introduction for the reasoning.
 *
 * apps/mcp-bridge's bin names, PID file and log prefixes used to be
 * allow-listed here too ("aipex-mcp-bridge" etc.) but were a real bug, not
 * an intentional contract: both READMEs told users to `npx -y
 * aipex-mcp-bridge` / `npm install -g aipex-mcp-bridge`, which resolves a
 * different, unrelated package on the public npm registry. Fixed by
 * renaming the bins to "apty-*" and documenting a local-build install
 * instead -- see DECISIONS.md.
 *
 * Production readiness (R2) renamed the storage keys, the agent-session
 * database, every name injected into customer pages and the log prefix to
 * Apty names. What is left is listed below, matched as whole tokens and
 * case-sensitively, so "[AIPex]" or "data-aipex-new" is caught even though
 * "AIPex" (the class) is allowed.
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

/** Tokens allowed exactly as written. */
const ALLOWED_TOKENS = new Set([
  // The upstream fork, by name, and @apty/agent-core's kept class names.
  "aipex",
  "AIPex",
  "AIPexOptions",
  "AIPexCore",
  "AIPexSkills",
  // Storage written by earlier versions: read once by the R2 migration
  // (storage/legacy-storage.ts, storage/agent-session-store.ts) or removed by
  // "Delete everything" (stored-data.ts).
  "aipex_theme",
  "aipex_language",
  "aipex_settings",
  "aipex_host_access_config",
  "aipex_automation_mode",
  "aipex_risky_origin_grants",
  "aipex_zenfs_migration_status",
  "aipex_zenfs_migration_v2_status",
  "aipex-input-mode",
  "aipex-sessions",
  "aipex_last_capture_event",
  // Databases an earlier version created, moved by storage/legacy-databases.ts,
  // and the localStorage keys the first conversation-storage migration reads.
  "aipex-conversations",
  "aipex-conversations-db",
  "aipex-conversations-migrated",
  "aipex-screenshots-db",
  "aipex-skills-fs",
  // The chat's screenshot placeholder host (aipex-screenshot.invalid); never
  // fetched, never on a page.
  "aipex-screenshot",
  // The upstream fork's second conversation-storage version, in
  // conversation/COMPATIBILITY.md and conversation/README.md.
  "new-aipex",
  // Source and test files of the AIPex class (aipex.ts, aipex-retry.test.ts).
  "aipex-retry",
  // Messages between the Agent's own contexts; never visible to a page.
  "aipex_open_omni",
  "aipex_close_omni",
  "aipex:collect-dom-snapshot",
  // apps/mcp-bridge env vars kept from the upstream CLI protocol.
  "AIPEX_WS_URL",
  "AIPEX_CONNECT_TIMEOUT",
]);

/** Allowed anywhere inside a token (URLs and long identifiers). */
const ALLOWED_PARTS = [
  "AIPEX_SCREENSHOT_URL_PREFIX",
  // github.com/AIPexStudio/AIPex, the fork's origin.
  "AIPexStudio",
  // "never run this" warnings naming the wrong upstream npm package.
  "aipex-mcp-bridge",
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
    if (unknown.length > 0) {
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
