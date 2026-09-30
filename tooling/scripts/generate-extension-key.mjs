#!/usr/bin/env node
/**
 * Generates a stable Chrome extension keypair and prints the manifest.json
 * `"key"` field + the extension ID that key derives to.
 *
 * Why this matters: without a manifest `key`, Chrome derives an unpacked
 * extension's ID from the absolute path it was loaded from — reload it
 * from a different folder (or a teammate loads the same source from their
 * own checkout) and the ID changes. Every `externally_connectable.ids`
 * allow-list a producer (Apty Client/Studio) configures for this agent, and
 * every build-time `VITE_APTY_ALLOWED_PEER_IDS` entry, is only stable if
 * this extension's own ID is stable — hence pinning it with a real keypair.
 *
 * Usage:
 *   node tooling/scripts/generate-extension-key.mjs
 *   node tooling/scripts/generate-extension-key.mjs --write   # also writes manifest.json's "key" field
 *
 * `--write` re-serializes the whole manifest via JSON.stringify, which
 * doesn't match this repo's Biome JSON formatting (compact short arrays) —
 * run `npx biome format --write apps/browser-extension/manifest.json`
 * afterward so the diff is just the new "key" line.
 *
 * The PRIVATE key is written to apps/browser-extension/.apty-agent-key.pem
 * (gitignored via the repo's `*.pem` rule) — never commit it. Re-running
 * this script when that file already exists reuses it (prints the same ID)
 * instead of silently generating a new one and changing the ID again.
 *
 * The Chrome Web Store issues its own keypair on first upload; once
 * published, replace the local dev key's derived id references with the
 * Store's own (see docs/integrations/apty/README.md) so dev and Store
 * builds don't quietly diverge — this script only solves the "unpacked ID
 * changes across reloads/checkouts" problem, not the separate "match the
 * published Store ID" one.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const EXT_DIR = join(ROOT, "apps/browser-extension");
const PRIVATE_KEY_PATH = join(EXT_DIR, ".apty-agent-key.pem");
const MANIFEST_PATH = join(EXT_DIR, "manifest.json");

const shouldWrite = process.argv.includes("--write");

/** Chrome's extension-id alphabet: each nibble (0-15) of the first 16 bytes of SHA-256(DER public key) maps to a letter a-p. */
function deriveExtensionId(publicKeyDer) {
  const digest = createHash("sha256").update(publicKeyDer).digest();
  const first16 = digest.subarray(0, 16);
  let id = "";
  for (const byte of first16) {
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;
    id += String.fromCharCode(97 + high); // 97 = 'a'
    id += String.fromCharCode(97 + low);
  }
  return id;
}

function loadOrCreateKeyPair() {
  if (existsSync(PRIVATE_KEY_PATH)) {
    const privateKeyPem = readFileSync(PRIVATE_KEY_PATH, "utf8");
    const privateKeyObject = createPrivateKey(privateKeyPem);
    const publicKey = createPublicKey(privateKeyObject).export({
      type: "spki",
      format: "pem",
    });
    return { privateKeyPem, publicKey };
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  return { privateKeyPem: privateKey, publicKey };
}

function pemToBase64Der(pem) {
  return pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
}

const { privateKeyPem, publicKey } = loadOrCreateKeyPair();
const publicKeyBase64 = pemToBase64Der(publicKey);
const publicKeyDer = Buffer.from(publicKeyBase64, "base64");
const extensionId = deriveExtensionId(publicKeyDer);

console.log(`Extension ID: ${extensionId}`);
console.log("");
console.log('manifest.json "key" field:');
console.log(publicKeyBase64);
console.log("");
console.log(`Private key: ${PRIVATE_KEY_PATH} (gitignored — never commit it)`);

if (shouldWrite) {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`\n✗ manifest.json not found at ${MANIFEST_PATH}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  manifest.key = publicKeyBase64;
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n✓ Wrote "key" into ${MANIFEST_PATH}`);
}

void privateKeyPem;
