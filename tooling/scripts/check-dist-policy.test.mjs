import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./check-dist-policy.mjs", import.meta.url),
);
const run = (dir) =>
  spawnSync(process.execPath, [script, dir], { encoding: "utf8" });

function distWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "dist-policy-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const manifest = JSON.stringify({
  storage: { managed_schema: "managed-schema.json" },
});

describe("check-dist-policy", () => {
  it("passes a build with the schema and no seam", () => {
    const dir = distWith({
      "manifest.json": manifest,
      "managed-schema.json": "{}",
      "assets/a.js": "chrome.storage.managed.get(null)",
    });
    try {
      const result = run(dir);
      assert.equal(result.status, 0, result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a build that holds the E2E policy key", () => {
    const dir = distWith({
      "manifest.json": manifest,
      "managed-schema.json": "{}",
      "assets/a.js": 'chrome.storage.local.get("apty-e2e-org-policy")',
    });
    try {
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /E2E policy seam/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a build without the managed schema", () => {
    const dir = distWith({ "manifest.json": manifest });
    try {
      const result = run(dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /managed schema/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
