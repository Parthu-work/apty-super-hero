#!/usr/bin/env node
/**
 * KB-RAG K22 (hard rule 7, acceptance check 10): a production build must not
 * hold the E2E test-policy seam, and must ship the managed-storage schema
 * its manifest names. Run by `npm run build` on apps/browser-extension/dist.
 *
 * Usage: node tooling/scripts/check-dist-policy.mjs [<dist dir>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The chrome.storage.local key the E2E build reads its policy from. */
export const SEAM_MARKERS = [
  "apty-e2e-org-policy",
  "VITE_APTY_E2E_POLICY_SEAM",
];

const dist =
  process.argv[2] ??
  fileURLToPath(new URL("../../apps/browser-extension/dist", import.meta.url));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const problems = [];
if (!existsSync(join(dist, "manifest.json"))) {
  problems.push(`no manifest.json in ${dist}: build the extension first`);
} else {
  const manifest = JSON.parse(
    readFileSync(join(dist, "manifest.json"), "utf8"),
  );
  const schema = manifest.storage?.managed_schema;
  if (!schema) problems.push("manifest.json names no storage.managed_schema");
  else if (!existsSync(join(dist, schema))) {
    problems.push(`the managed schema ${schema} is not in the build`);
  }
  for (const file of files(dist).filter((f) => /\.(js|html|json)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    for (const marker of SEAM_MARKERS) {
      if (text.includes(marker)) {
        problems.push(`${file} holds the E2E policy seam (${marker})`);
      }
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log("✓ The build ships the managed schema and no E2E policy seam");
