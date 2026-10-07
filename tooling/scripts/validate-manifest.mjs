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

// externally_connectable must stay empty: omitting this field entirely, or
// listing any id, lets other installed extensions message this one.
if (
  !manifest.externally_connectable ||
  !Array.isArray(manifest.externally_connectable.ids) ||
  manifest.externally_connectable.ids.length !== 0
) {
  errors.push(
    "externally_connectable.ids must be present and an empty array ([]) — " +
      "cross-extension messaging (e.g. the Apty Client peer connection) is " +
      "user-approved at the application layer, not granted to arbitrary " +
      "extensions via the manifest.",
  );
}

// Every permission must have a documented, verified justification in
// docs/security/PERMISSIONS.md, and every justification there must still
// correspond to a real permission — this fails on either an unreviewed
// new permission or a stale doc entry for one that's been removed.
const PERMISSIONS_DOC_PATH = join(ROOT, "docs/security/PERMISSIONS.md");
if (!existsSync(PERMISSIONS_DOC_PATH)) {
  errors.push(
    `docs/security/PERMISSIONS.md not found at ${PERMISSIONS_DOC_PATH}`,
  );
} else {
  const doc = readFileSync(PERMISSIONS_DOC_PATH, "utf8");
  // Rows of the form "| `permName` | ... |" in the top-level table — not
  // host_permissions (documented separately, see below) and not anything
  // inside the "Confirmed unused, removed" / "Not attempted" sections
  // (backtick-quoted permission names there are historical notes, not
  // current justifications).
  const tableSection = doc.split(/^## /m)[0];
  const documented = new Set(
    [...tableSection.matchAll(/^\| `([a-zA-Z]+)` \|/gm)].map((m) => m[1]),
  );

  // optional_permissions (requested at runtime via chrome.permissions.request,
  // not granted at install) still need the same documented justification as
  // an unconditional permission — just via a different manifest field.
  const manifestPermissions = new Set([
    ...(manifest.permissions ?? []),
    ...(manifest.optional_permissions ?? []),
  ]);

  for (const perm of manifestPermissions) {
    if (!documented.has(perm)) {
      errors.push(
        `permission "${perm}" is in manifest.json but not justified in docs/security/PERMISSIONS.md`,
      );
    }
  }
  for (const perm of documented) {
    if (!manifestPermissions.has(perm)) {
      errors.push(
        `docs/security/PERMISSIONS.md documents "${perm}", which is no longer in manifest.json's permissions/optional_permissions — remove the stale entry`,
      );
    }
  }

  const hasAllUrlsHostPermDoc = /<all_urls>/.test(doc);
  if (
    (manifest.host_permissions ?? []).includes("<all_urls>") &&
    !hasAllUrlsHostPermDoc
  ) {
    errors.push(
      'host_permissions includes "<all_urls>" but docs/security/PERMISSIONS.md has no justification for it',
    );
  }
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
