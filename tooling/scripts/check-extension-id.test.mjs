import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkIntegrationIds,
  extensionIdFromKey,
  pinnedAgentId,
} from "./check-extension-id.mjs";

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
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    assert.match(extensionIdFromKey(key), /^[a-p]{32}$/);
  });

  it("fails on another key and on a manifest without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-id-"));
    dirs.push(dir);
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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

  describe("--docs: the Agent's IDs in the Apty integration files", () => {
    const PINNED = "bpiondflhhdplemamgggcdajclmoeple";
    const STORE = "aaaabbbbccccddddeeeeffffgggghhhh";
    const OTHER = "pppppppppppppppppppppppppppppppp";
    const PLACEHOLDER = "<the Web Store ID, once assigned>";

    function integrationRoot(files) {
      const root = mkdtempSync(join(tmpdir(), "ext-id-docs-"));
      dirs.push(root);
      const dir = join(root, "docs/integrations/apty");
      mkdirSync(dir, { recursive: true });
      for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(dir, name), text);
      }
      return root;
    }
    const listing = (...ids) =>
      `"externally_connectable": { "ids": [${ids.map((id) => `"${id}"`).join(", ")}] }`;

    it("passes on this repository and reports the store ID as pending", () => {
      const out = execFileSync("node", [SCRIPT, "--docs"], {
        encoding: "utf8",
      });
      assert.match(out, /list the pinned Agent ID/);
      assert.match(out, /Pending: the Chrome Web Store has not assigned/);
      assert.match(out, /apty-widget-service-worker\.reference\.ts/);
      assert.match(out, /CLIENT-PATCH\.md/);
    });

    it("fails when a file lists another ID or leaves out the placeholder", () => {
      const root = integrationRoot({
        "README.md": listing(PINNED, PLACEHOLDER),
        "CLIENT-PATCH.md": listing(PINNED, OTHER, PLACEHOLDER),
        "STUDIO.md": listing(PINNED),
        "NOTES.md": "Nothing about IDs here.",
      });

      const { checked, failures, pending } = checkIntegrationIds({
        root,
        pinned: PINNED,
        storeId: null,
      });

      assert.deepEqual(checked, [
        "docs/integrations/apty/CLIENT-PATCH.md",
        "docs/integrations/apty/README.md",
        "docs/integrations/apty/STUDIO.md",
      ]);
      assert.deepEqual(failures, [
        `docs/integrations/apty/CLIENT-PATCH.md lists ${OTHER}, which is not an Agent ID`,
        "docs/integrations/apty/STUDIO.md has no placeholder for the Web Store ID, which is not assigned yet",
      ]);
      assert.deepEqual(pending, [
        "docs/integrations/apty/CLIENT-PATCH.md",
        "docs/integrations/apty/README.md",
      ]);
    });

    it("once the store ID exists, requires it everywhere and no placeholder left", () => {
      const root = integrationRoot({
        "README.md": listing(PINNED, STORE),
        "STUDIO.md": listing(PINNED, PLACEHOLDER),
      });

      const { failures, pending } = checkIntegrationIds({
        root,
        pinned: PINNED,
        storeId: STORE,
      });

      assert.deepEqual(failures, [
        `docs/integrations/apty/STUDIO.md does not list the Web Store ID ${STORE}`,
        "docs/integrations/apty/STUDIO.md still has a Web Store ID placeholder",
      ]);
      assert.deepEqual(pending, []);
    });
  });
});
