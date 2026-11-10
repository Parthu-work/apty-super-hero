#!/usr/bin/env node
/**
 * KB-RAG K22 (S2, acceptance check 9): every settings reader goes through
 * `loadEffectiveSettings()` (packages/browser-runtime/src/runtime/effective-settings.ts),
 * so the organization policy applies everywhere. Fails when a source file
 * outside ALLOWED names `STORAGE_KEYS.SETTINGS`, or when the extension hands
 * the settings UI a storage adapter other than `settingsStorageAdapter`
 * (the language and theme providers keep their own adapters).
 *
 * Usage: node tooling/scripts/check-settings-readers.mjs [<repo root>]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Files that may name the settings key, and why. */
export const ALLOWED = {
  "packages/browser-runtime/src/runtime/effective-settings.ts":
    "the helper itself",
  "packages/ui/src/hooks/use-chat-config.ts":
    "reads through the injected adapter, which the extension sets to settingsStorageAdapter",
  "packages/ui/src/components/settings/index.tsx":
    "reads through the injected adapter, which the extension sets to settingsStorageAdapter",
};

const ROOTS = ["packages", "apps/browser-extension/src"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "examples"]);

function sources(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    if (name.endsWith(".d.ts")) return [];
    return [path];
  });
}

export function findViolations(root) {
  const violations = [];
  for (const base of ROOTS) {
    for (const file of sources(join(root, base))) {
      const rel = relative(root, file).split(sep).join("/");
      const text = readFileSync(file, "utf8");
      if (text.includes("STORAGE_KEYS.SETTINGS") && !(rel in ALLOWED)) {
        violations.push(
          `${rel} names STORAGE_KEYS.SETTINGS: read the settings with loadSettings() or loadEffectiveSettings()`,
        );
      }
      if (rel.startsWith("apps/browser-extension/")) {
        for (const match of text.matchAll(
          /storageAdapter\s*(?:=\s*\{|:)\s*([A-Za-z_$][\w$]*)/g,
        )) {
          const name = match[1];
          if (name === "i18nStorageAdapter" || name === "themeStorageAdapter") {
            continue;
          }
          if (name !== "settingsStorageAdapter") {
            violations.push(
              `${rel} gives the settings UI ${name}: use settingsStorageAdapter`,
            );
          }
        }
      }
    }
  }
  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root =
    process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url));
  const violations = findViolations(root);
  if (violations.length > 0) {
    for (const violation of violations) console.error(`✗ ${violation}`);
    process.exit(1);
  }
  console.log("✓ every settings reader goes through loadEffectiveSettings()");
}
