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
 * With --docs, checks that every Apty-side integration file that lists the
 * Agent's IDs (the reference module, the README, CLIENT-PATCH.md, STUDIO.md
 * and any other file in docs/integrations/apty/ that names
 * `externally_connectable` or `DEBUG_AGENT_EXTENSION_IDS`) lists exactly
 * the pinned ID and the Web Store ID. Until the store assigns one
 * (`AGENT_WEB_STORE_ID` below is null), each must hold a placeholder for
 * it instead, and the check reports it as pending, not as a failure.
 *
 * Usage: node tooling/scripts/check-extension-id.mjs [manifest.json] [expected-id]
 *        node tooling/scripts/check-extension-id.mjs --store <manifest.json>
 *        node tooling/scripts/check-extension-id.mjs --docs
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
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

/**
 * The Agent's Chrome Web Store ID, null until the first store upload assigns
 * it. When it exists, set it here and replace every placeholder in
 * docs/integrations/apty/ in the same commit; `--docs` then fails on any
 * placeholder left.
 */
export const AGENT_WEB_STORE_ID = null;

const INTEGRATION_DIR = "docs/integrations/apty";
/** Where a file lists the IDs another extension must allow. */
const LISTS_IDS = /externally_connectable|DEBUG_AGENT_EXTENSION_IDS/;
const QUOTED_ID = /["'`]([a-p]{32})["'`]/g;
const STORE_PLACEHOLDER = /<[^<>\n]*Web Store ID[^<>\n]*>/i;

/**
 * What each integration file says about the Agent's IDs. `failures` are
 * disagreements; `pending` names the files still waiting on the store ID.
 */
export function checkIntegrationIds({
  root = ROOT,
  pinned = pinnedAgentId(),
  storeId = AGENT_WEB_STORE_ID,
} = {}) {
  const dir = resolve(root, INTEGRATION_DIR);
  const failures = [];
  const pending = [];
  const checked = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(md|ts)$/.test(name)) continue;
    const path = join(dir, name);
    const text = readFileSync(path, "utf8");
    if (!LISTS_IDS.test(text)) continue;
    const file = relative(root, path);
    checked.push(file);
    const ids = new Set([...text.matchAll(QUOTED_ID)].map((m) => m[1]));
    if (!ids.has(pinned)) {
      failures.push(`${file} does not list the pinned Agent ID ${pinned}`);
    }
    for (const id of ids) {
      if (id !== pinned && id !== storeId) {
        failures.push(`${file} lists ${id}, which is not an Agent ID`);
      }
    }
    const placeholder = STORE_PLACEHOLDER.test(text);
    if (storeId) {
      if (!ids.has(storeId)) {
        failures.push(`${file} does not list the Web Store ID ${storeId}`);
      }
      if (placeholder) {
        failures.push(`${file} still has a Web Store ID placeholder`);
      }
    } else if (placeholder) {
      pending.push(file);
    } else {
      failures.push(
        `${file} has no placeholder for the Web Store ID, which is not assigned yet`,
      );
    }
  }
  return { checked, failures, pending };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "--docs") {
    const { checked, failures, pending } = checkIntegrationIds();
    for (const failure of failures) console.error(`✗ ${failure}`);
    if (failures.length > 0) process.exit(1);
    console.log(
      `✓ ${checked.length} integration files list the pinned Agent ID ${pinnedAgentId()} and nothing else`,
    );
    if (pending.length > 0) {
      console.log(
        `… Pending: the Chrome Web Store has not assigned the Agent's store ID; ${pending.length} files hold a placeholder for it (${pending.join(", ")})`,
      );
    }
    process.exit(0);
  }
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
