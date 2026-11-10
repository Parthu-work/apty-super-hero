import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findViolations } from "./check-settings-readers.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "settings-readers-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("check-settings-readers", () => {
  it("passes this repository", () => {
    assert.deepEqual(findViolations(REPO), []);
  });

  it("flags a direct read of the settings key outside the helper", () => {
    const dir = tree({
      "packages/browser-runtime/src/tools/x.ts":
        "chrome.storage.local.get(STORAGE_KEYS.SETTINGS)",
      "packages/browser-runtime/src/tools/x.test.ts":
        "chrome.storage.local.get(STORAGE_KEYS.SETTINGS)",
      "packages/browser-runtime/src/runtime/effective-settings.ts":
        "chrome.storage.local.get(STORAGE_KEYS.SETTINGS)",
    });
    try {
      const violations = findViolations(dir);
      assert.equal(violations.length, 1);
      assert.match(violations[0], /tools\/x\.ts names STORAGE_KEYS\.SETTINGS/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags the raw chrome adapter handed to the settings UI", () => {
    const dir = tree({
      "apps/browser-extension/src/a.tsx":
        "<SettingsPage storageAdapter={chromeStorageAdapter} />",
      "apps/browser-extension/src/b.tsx":
        "useChatConfig({ storageAdapter: settingsStorageAdapter })",
    });
    try {
      assert.deepEqual(findViolations(dir), [
        "apps/browser-extension/src/a.tsx gives the settings UI chromeStorageAdapter: use settingsStorageAdapter",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
