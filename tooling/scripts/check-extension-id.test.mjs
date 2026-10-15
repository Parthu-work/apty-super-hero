import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extensionIdFromKey, pinnedAgentId } from "./check-extension-id.mjs";

const SCRIPT = fileURLToPath(
  new URL("./check-extension-id.mjs", import.meta.url),
);
const MANIFEST = fileURLToPath(
  new URL("../../apps/browser-extension/manifest.json", import.meta.url),
);
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("check-extension-id", () => {
  it("derives the pinned Agent ID from the source manifest's key", () => {
    assert.match(
      execFileSync("node", [SCRIPT, MANIFEST], { encoding: "utf8" }),
      new RegExp(`yields the pinned Agent ID ${pinnedAgentId()}`),
    );
  });

  it("maps the key's hash to 32 letters a-p", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const key = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    assert.match(extensionIdFromKey(key), /^[a-p]{32}$/);
  });

  it("fails on another key and on a manifest without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-id-"));
    dirs.push(dir);
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const other = join(dir, "other.json");
    writeFileSync(
      other,
      JSON.stringify({
        key: publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      }),
    );
    const none = join(dir, "none.json");
    writeFileSync(none, "{}");
    assert.throws(
      () => execFileSync("node", [SCRIPT, other], { stdio: "pipe" }),
      /expected/,
    );
    assert.throws(
      () => execFileSync("node", [SCRIPT, none], { stdio: "pipe" }),
      /no "key"/,
    );
  });

  it("--store passes a Web Store manifest without a key, and fails one with a key (D2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-id-"));
    dirs.push(dir);
    const store = join(dir, "store.json");
    writeFileSync(store, JSON.stringify({ name: "Apty Agent" }));

    assert.match(
      execFileSync("node", [SCRIPT, "--store", store], { encoding: "utf8" }),
      /no "key"/,
    );
    assert.throws(
      () =>
        execFileSync("node", [SCRIPT, "--store", MANIFEST], { stdio: "pipe" }),
      /still has a "key"/,
    );
  });
});
