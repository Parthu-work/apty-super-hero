#!/usr/bin/env node
/**
 * Enforces the dependency-direction rules from ARCHITECTURE.md/CONTRIBUTING.md:
 *
 *   apps            -> packages
 *   packages/ui               -> packages/agent-core only (never browser-runtime)
 *   packages/browser-runtime  -> packages/agent-core, packages/dom-snapshot
 *   packages/agent-core, packages/dom-snapshot -> nothing (leaf packages)
 *   packages/*      -> never apps/*
 *
 * Static, import-based checks (grep for import specifiers), not a full
 * module-graph analysis -- deliberately simple so it stays easy to reason
 * about and fast enough to run on every change.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) yield full;
  }
}

function importSpecifiers(content) {
  const importRe = /(?:from|require\()\s*["']([^"']+)["']/g;
  return [...content.matchAll(importRe)].map((m) => m[1]);
}

const violations = [];

function checkPackage(srcDir, forbiddenPrefixes) {
  const dir = join(ROOT, srcDir);
  let files;
  try {
    files = [...walk(dir)];
  } catch {
    return;
  }
  for (const file of files) {
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const content = readFileSync(file, "utf8");
    for (const spec of importSpecifiers(content)) {
      for (const prefix of forbiddenPrefixes) {
        if (spec === prefix || spec.startsWith(`${prefix}/`)) {
          violations.push(
            `${relative(ROOT, file)}: imports "${spec}", forbidden from ${srcDir}`,
          );
        }
      }
    }
  }
}

// packages/ui must never import @apty/browser-runtime
checkPackage("packages/ui/src", ["@apty/browser-runtime"]);

// packages/agent-core and packages/dom-snapshot are leaves: no @apty/* imports at all
checkPackage("packages/agent-core/src", [
  "@apty/dom-snapshot",
  "@apty/browser-runtime",
  "@apty/ui",
]);
checkPackage("packages/dom-snapshot/src", [
  "@apty/agent-core",
  "@apty/browser-runtime",
  "@apty/ui",
]);

// packages/* must never import from apps/*
for (const pkg of ["agent-core", "dom-snapshot", "browser-runtime", "ui"]) {
  checkPackage(`packages/${pkg}/src`, [
    "apps/",
    "../../apps/",
    "../../../apps/",
  ]);
}

if (violations.length > 0) {
  console.error(
    `\n✗ Found ${violations.length} architecture-boundary violation(s):\n`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error("\nSee CONTRIBUTING.md's Dependency rules section.\n");
  process.exit(1);
} else {
  console.log("✓ No architecture-boundary violations found.");
}
