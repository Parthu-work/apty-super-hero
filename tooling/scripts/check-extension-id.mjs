#!/usr/bin/env node
/**
 * Checks that a manifest's `key` yields the pinned Agent extension ID the
 * e2e harness and the Apty Client allow-list (`AGENT_EXTENSION_ID` in
 * tooling/e2e/harness.mjs). Chrome derives the ID from the SHA-256 of the
 * public key: the first 32 hex digits, each mapped 0-f → a-p.
 *
 * With --store, checks the opposite for the Chrome Web Store package: its
 * manifest must have no `key`, because the store rejects one and assigns
 * its own ID (owner decision D2).
 *
 * Usage: node tooling/scripts/check-extension-id.mjs [manifest.json] [expected-id]
 *        node tooling/scripts/check-extension-id.mjs --store <manifest.json>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export function extensionIdFromKey(base64Key) {
  const hex = createHash("sha256")
    .update(Buffer.from(base64Key, "base64"))
    .digest("hex")
    .slice(0, 32);
  return [...hex]
    .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
    .join("");
}

export function pinnedAgentId() {
  const harness = readFileSync(
    resolve(ROOT, "tooling/e2e/harness.mjs"),
    "utf8",
  );
  const match = /export const AGENT_EXTENSION_ID = "([a-p]{32})"/.exec(harness);
  if (!match)
    throw new Error("AGENT_EXTENSION_ID not found in tooling/e2e/harness.mjs");
  return match[1];
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "--store") {
    const storePath = resolve(process.argv[3] ?? "");
    const store = JSON.parse(readFileSync(storePath, "utf8"));
    if ("key" in store) {
      console.error(
        `✗ ${storePath} still has a "key"; the Web Store rejects it`,
      );
      process.exit(1);
    }
    console.log(`✓ ${storePath} has no "key"; the Web Store assigns the ID`);
    process.exit(0);
  }
  const manifestPath = resolve(
    process.argv[2] ??
      resolve(ROOT, "apps/browser-extension/dist/manifest.json"),
  );
  const expected = process.argv[3] ?? pinnedAgentId();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.key !== "string") {
    console.error(
      `✗ ${manifestPath} has no "key", so the extension ID is not pinned`,
    );
    process.exit(1);
  }
  const actual = extensionIdFromKey(manifest.key);
  if (actual !== expected) {
    console.error(`✗ The manifest key yields ${actual}, expected ${expected}`);
    process.exit(1);
  }
  console.log(`✓ The manifest key yields the pinned Agent ID ${actual}`);
}
