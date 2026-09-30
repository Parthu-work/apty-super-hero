#!/usr/bin/env node
/**
 * WP1.2 gate: every install/run command in apps/mcp-bridge's docs must
 * reference a real bin name from apps/mcp-bridge/package.json, never a
 * package name resolved from the public npm registry (this package is
 * `"private": true` and not published — `npx -y <name>` or
 * `npm install -g <name>` would either 404 or, worse, silently install a
 * different, unrelated package that happens to share a name).
 *
 * Concretely, this repo shipped exactly that bug for a long time: both
 * READMEs told users to run `npx -y aipex-mcp-bridge` / `npm install -g
 * aipex-mcp-bridge`, which resolves the real (and unrelated) upstream
 * AIPex package, not this repo's own `apty-mcp-bridge`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const MCP_BRIDGE_DIR = join(ROOT, "apps/mcp-bridge");

const DOC_FILES = [
  join(ROOT, "README.md"),
  join(MCP_BRIDGE_DIR, "README.md"),
  join(ROOT, "skill/SKILL.md"),
  join(ROOT, "skill/references/tools-reference.md"),
];

const errors = [];

const pkg = JSON.parse(
  readFileSync(join(MCP_BRIDGE_DIR, "package.json"), "utf8"),
);
const realBinNames = new Set(Object.keys(pkg.bin ?? {}));
const realPackageName = pkg.name;

if (pkg.private !== true) {
  errors.push(
    `apps/mcp-bridge/package.json is not "private": true — an accidental ` +
      `\`npm publish\` would ship this unreviewed internal tool under a ` +
      `real, installable package name.`,
  );
}

// Commands of the shape `npx [-y] <name>` or `npm install -g <name>` /
// `npm i -g <name>` anywhere in the doc. Each matched `<name>` must never
// be usable this way: this package isn't published, so nothing should
// ever tell a user (or an agent reading skill/SKILL.md) to fetch it by
// name from the registry.
const REGISTRY_INSTALL_PATTERN =
  /\bnp(?:x|m)\s+(?:-y\s+|install\s+-g\s+|i\s+-g\s+)([a-zA-Z0-9@/_.-]+)/g;

// A bare invocation of one of this package's own bin names as if it were
// already on PATH, e.g. `apty-cli --list` or `browser-cli status`
// (excluding the `node dist/x.js` form, which is always correct since it
// runs the real local build).
const BARE_BIN_INVOCATION_PATTERN =
  /(?:^|[`\s])(apty-mcp-bridge|apty-mcp-daemon|apty-cli|browser-cli|aipex-[a-z-]+)(?=[`\s]|$)/gm;

for (const file of DOC_FILES) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const relPath = file.replace(ROOT, "");

  for (const match of text.matchAll(REGISTRY_INSTALL_PATTERN)) {
    const name = match[1];
    // A sentence explicitly warning not to do this is fine — it names the
    // bad package on purpose. Anything else naming a registry-installable
    // package by name in this exact command shape is the bug.
    const context = text.slice(
      Math.max(0, match.index - 60),
      match.index + match[0].length + 10,
    );
    const isWarning = /never|don't|do not|instead of|resolves/i.test(context);
    if (!isWarning) {
      errors.push(
        `${relPath}: "${match[0]}" installs/runs "${name}" from the public npm registry, but ${realPackageName} is not published there.`,
      );
    }
  }

  for (const match of text.matchAll(BARE_BIN_INVOCATION_PATTERN)) {
    const name = match[1];
    if (name.startsWith("aipex-")) {
      // Same exemption as above: a "never do this" warning may name it.
      const context = text.slice(
        Math.max(0, match.index - 60),
        match.index + match[0].length + 10,
      );
      if (!/never|don't|do not|instead of|resolves|unrelated/i.test(context)) {
        errors.push(
          `${relPath}: "${name}" is not a real bin of ${realPackageName} (bins are: ${[...realBinNames].join(", ")}).`,
        );
      }
      continue;
    }
    if (!realBinNames.has(name)) {
      errors.push(
        `${relPath}: "${name}" is invoked as if it were on PATH, but it is not one of ${realPackageName}'s bin names (${[...realBinNames].join(", ")}). If it should be run this way, add it to package.json's "bin"; otherwise invoke the built file directly (node dist/...).`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("✗ MCP bridge docs check failed:\n");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  "✓ MCP bridge docs: no command references an unpublished/wrong package, package.json is private",
);
