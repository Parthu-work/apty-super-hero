import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-branding.mjs", import.meta.url));

function scan(files) {
  const root = mkdtempSync(join(tmpdir(), "branding-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("check-branding", () => {
  it("passes the names kept on purpose", () => {
    const result = scan({
      "src/migrate.ts":
        'const LEGACY = { aipex_settings: "apty_settings" };\nexport class AIPex {}\n',
      "src/db.ts": 'const DB = "aipex-conversations-db";\n',
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it("flags an AIPex log prefix in a .js file", () => {
    const result = scan({
      "src/skill.js": 'console.log("[AIPex] started");\n',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/skill\.js:1/);
  });

  it("flags a new page-visible aipex name", () => {
    const result = scan({
      "src/page.ts": 'el.setAttribute("data-aipex-marker", "1");\n',
      "src/style.mjs": 'style.id = "aipex-new-overlay";\n',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/page\.ts:1/);
    assert.match(result.stderr, /src\/style\.mjs:1/);
  });

  it("flags a new aipex_ storage key that isn't a known legacy name", () => {
    const result = scan({
      "src/keys.ts": 'const KEY = "aipex_new_feature";\n',
    });
    assert.equal(result.status, 1);
  });
});
