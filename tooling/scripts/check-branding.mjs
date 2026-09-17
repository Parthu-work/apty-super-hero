#!/usr/bin/env node
/**
 * Fails if a new, unreviewed "aipex"/"AIPex" reference shows up.
 *
 * The repo intentionally keeps a small, fixed set of "aipex"-branded
 * identifiers that are real data/behavior contracts, not cosmetic branding:
 * chrome.storage/IndexedDB keys and DB names, DOM attribute/class names,
 * cross-context message action strings, the AIPex class name in
 * @apty/agent-core, and apps/mcp-bridge's external CLI identity (bin names,
 * env vars, log prefixes). Renaming any of those would be a behavior change,
 * not a branding fix -- see DECISIONS.md and the git history of this script's
 * introduction for the reasoning.
 *
 * This script scans for the word "aipex" (case-insensitive) and reports
 * anything NOT already covered by the allowlist below, so an accidental new
 * "AIPex" reference (e.g. a copy-pasted comment, a new stale path) gets
 * caught, without re-litigating the identifiers this repo has deliberately
 * kept.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".md", ".json"]);

// Exact substrings that are allowed anywhere: real, unrenamed contracts.
const ALLOWED_SUBSTRINGS = [
  // packages/agent-core's kept class/type name
  "AIPex",
  "AIPexOptions",
  "AIPexCore",
  // storage keys / IndexedDB / DB names (must stay stable for existing user data)
  "aipex_",
  "aipex-conversations",
  "aipex-screenshots-db",
  "aipex-sessions",
  "aipex-input-mode",
  "aipex-pending-prompt",
  "aipex-skills-fs",
  "aipex_zenfs_migration",
  "aipex-conversation-active",
  "AIPexSkills",
  // DOM attribute/class contracts + cross-context message strings
  "data-aipex-",
  "aipex-capture-",
  "aipex-content-root",
  "aipex-border-overlay",
  "aipex-text-highlight",
  "__aipexCaptureCleanup",
  "__aipexHighlightOriginal",
  "__aipexHighlightTimeoutId",
  "_aipexOriginalStyles",
  "aipexBreathe",
  "aipex:collect-dom-snapshot",
  "aipex_open_omni",
  "aipex_close_omni",
  "aipex-screenshot.invalid",
  "AIPEX_SCREENSHOT_URL_PREFIX",
  // apps/mcp-bridge's own external CLI identity (bin names, env vars, PID file)
  "aipex-mcp-bridge",
  "aipex-mcp-daemon",
  "aipex-cli",
  "aipex-browser-cli",
  "aipex-browser",
  "aipex-daemon",
  "aipex-bridge",
  "AIPEX_WS_URL",
  "AIPEX_CONNECT_TIMEOUT",
  ".aipex-daemon.pid",
  "check_aipex_connection",
  "aipex.ai",
  // historical/narrative references (fork origin, changelog, decisions, security log)
  "AIPexStudio",
  "aipex-whole",
];

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");

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

function isAllowedMatch(line) {
  return ALLOWED_SUBSTRINGS.some((allowed) =>
    line.toLowerCase().includes(allowed.toLowerCase()),
  );
}

const findings = [];

for (const file of walk(ROOT)) {
  if (file.endsWith("pnpm-lock.yaml")) continue;
  if (file.includes(`${join("tooling", "scripts")}`)) continue; // this file's own allowlist mentions "aipex"
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!/aipex/i.test(content)) continue;

  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (/aipex/i.test(line) && !isAllowedMatch(line)) {
      findings.push({
        file: relative(ROOT, file),
        line: idx + 1,
        text: line.trim(),
      });
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
      "ALLOWED_SUBSTRINGS in tooling/scripts/check-branding.mjs and explain why.\n",
  );
  process.exit(1);
} else {
  if (verbose) console.log("Scanned for stray AIPex branding.");
  console.log("✓ No unreviewed AIPex branding found.");
}
