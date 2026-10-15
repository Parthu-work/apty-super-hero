#!/usr/bin/env node
/**
 * Fails unless the built extension ships its licence, the third-party notices
 * and the Inter font licence, each non-empty.
 *
 * Usage: node tooling/scripts/check-dist-licences.mjs [<dist dir>]
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_LICENCE_FILES = [
  "LICENSE",
  "THIRD_PARTY_NOTICES.txt",
  "assets/Inter-OFL.txt",
];

const dist =
  process.argv[2] ??
  fileURLToPath(new URL("../../apps/browser-extension/dist", import.meta.url));

const missing = REQUIRED_LICENCE_FILES.filter((file) => {
  const path = join(dist, file);
  return !existsSync(path) || readFileSync(path, "utf8").trim() === "";
});

if (missing.length > 0) {
  console.error(`✗ The build at ${dist} is missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(
  "✓ The build ships LICENSE, THIRD_PARTY_NOTICES.txt and the Inter OFL",
);
