#!/usr/bin/env node
/**
 * Validates apps/browser-extension/manifest.json: required MV3 fields are
 * present, and every entrypoint file it references actually exists on disk.
 * Catches the exact class of bug a file move/rename can silently introduce
 * (a manifest path pointing at a file that no longer exists).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const EXT_DIR = join(ROOT, "apps/browser-extension");
const MANIFEST_PATH = join(EXT_DIR, "manifest.json");

const errors = [];

if (!existsSync(MANIFEST_PATH)) {
  console.error(`✗ Manifest not found at ${MANIFEST_PATH}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

function requireField(path, value) {
  if (value === undefined || value === null || value === "") {
    errors.push(`missing required field: ${path}`);
  }
}

function requireFile(path, relativeToManifest) {
  const full = join(EXT_DIR, relativeToManifest);
  if (!existsSync(full)) {
    errors.push(
      `${path} references "${relativeToManifest}", which does not exist (expected at ${full})`,
    );
  }
}

requireField("manifest_version", manifest.manifest_version);
requireField("name", manifest.name);
requireField("version", manifest.version);

if (manifest.manifest_version !== 3) {
  errors.push(`manifest_version must be 3, got ${manifest.manifest_version}`);
}

if (manifest.background?.service_worker) {
  requireFile("background.service_worker", manifest.background.service_worker);
  if (manifest.background.type !== "module") {
    errors.push('background.type should be "module" for an ESM service worker');
  }
} else {
  errors.push("missing background.service_worker");
}

if (Array.isArray(manifest.content_scripts)) {
  manifest.content_scripts.forEach((cs, i) => {
    for (const js of cs.js ?? []) {
      requireFile(`content_scripts[${i}].js`, js);
    }
  });
} else {
  errors.push("missing content_scripts");
}

if (manifest.side_panel?.default_path) {
  requireFile("side_panel.default_path", manifest.side_panel.default_path);
} else {
  errors.push("missing side_panel.default_path");
}

if (manifest.options_ui?.page) {
  requireFile("options_ui.page", manifest.options_ui.page);
} else {
  errors.push("missing options_ui.page");
}

// Icons referenced relative to the extension root, not manifest-adjacent source paths
for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  requireFile(`icons.${size}`, path);
}

if (errors.length > 0) {
  console.error(
    `\n✗ manifest.json validation failed (${errors.length} issue(s)):\n`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  console.error("");
  process.exit(1);
} else {
  console.log(
    "✓ manifest.json is valid and every referenced entrypoint file exists.",
  );
}
