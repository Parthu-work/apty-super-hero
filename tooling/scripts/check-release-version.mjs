#!/usr/bin/env node
/**
 * Fails unless a release tag (vX.Y.Z) matches the version in the extension
 * manifest and the extension's package.json, so a published zip always
 * reports the version it was tagged as.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(`${root}/${path}`, "utf8"));

const tag = process.argv[2] ?? "";
const tagVersion = tag.replace(/^v/, "");
const versions = {
  "apps/browser-extension/manifest.json": readJson(
    "apps/browser-extension/manifest.json",
  ).version,
  "apps/browser-extension/package.json": readJson(
    "apps/browser-extension/package.json",
  ).version,
};

const mismatched = Object.entries(versions).filter(
  ([, version]) => version !== tagVersion,
);
if (!/^\d+\.\d+\.\d+$/.test(tagVersion) || mismatched.length > 0) {
  console.error(`✗ Tag "${tag}" does not match the extension version:`);
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version}`);
  }
  process.exit(1);
}
console.log(`✓ ${tag} matches the manifest and package.json`);
