#!/usr/bin/env node
/**
 * Scans packages/agent-core and packages/browser-runtime's `tools/`
 * directories for `tool({ name: "..." })` registrations and flags:
 *   - duplicate tool names (two tools registered under the same name)
 *   - tool names that don't match the snake_case convention every existing
 *     tool follows
 *
 * This is a static text scan, not a module-graph analysis -- it finds every
 * `tool({...})` call regardless of whether tools/index.ts currently
 * re-exports it, which is deliberate: packages/browser-runtime/src/tools/tools/
 * contains gated/unregistered tool implementations awaiting security review
 * (see the commit that reorganized browser-runtime), and this script should
 * still catch a name collision between an active and a gated tool.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const TOOL_DIRS = [
  "packages/agent-core/src/tools",
  "packages/browser-runtime/src/tools",
];
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (extname(entry) === ".ts" && !entry.endsWith(".test.ts"))
      yield full;
  }
}

const registrations = []; // { name, file, line }
const TOOL_CALL_RE = /\btool\(\s*\{\s*\n\s*name:\s*"([^"]+)"/g;

for (const toolDir of TOOL_DIRS) {
  const dir = join(ROOT, toolDir);
  let files;
  try {
    files = [...walk(dir)];
  } catch {
    continue;
  }
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    TOOL_CALL_RE.lastIndex = 0;
    for (const m of content.matchAll(TOOL_CALL_RE)) {
      const line = content.slice(0, m.index).split("\n").length;
      registrations.push({ name: m[1], file: relative(ROOT, file), line });
    }
  }
}

const byName = new Map();
for (const reg of registrations) {
  if (!byName.has(reg.name)) byName.set(reg.name, []);
  byName.get(reg.name).push(reg);
}

const duplicates = [...byName.entries()].filter(([, regs]) => regs.length > 1);
const badNames = registrations.filter((r) => !SNAKE_CASE.test(r.name));

let failed = false;

console.log(
  `Found ${registrations.length} tool registration(s) across ${TOOL_DIRS.length} director${TOOL_DIRS.length === 1 ? "y" : "ies"}.`,
);

if (duplicates.length > 0) {
  failed = true;
  console.error(`\n✗ ${duplicates.length} duplicate tool name(s):\n`);
  for (const [name, regs] of duplicates) {
    console.error(`  "${name}":`);
    for (const r of regs) console.error(`    - ${r.file}:${r.line}`);
  }
}

if (badNames.length > 0) {
  failed = true;
  console.error(`\n✗ ${badNames.length} tool name(s) not in snake_case:\n`);
  for (const r of badNames)
    console.error(`  - "${r.name}" (${r.file}:${r.line})`);
}

if (failed) {
  console.error("");
  process.exit(1);
} else {
  console.log("✓ No duplicate tool names or naming-convention violations.");
}
