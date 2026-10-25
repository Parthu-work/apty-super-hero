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
  for (const [name, line] of [
    ["the fork's name", "// Forked from AIPex; aipex names are gone."],
    [
      "the legacy screenshot host",
      'const OLD = "https://aipex-screenshot.invalid/";',
    ],
    ["AIPEX_WS_URL", "const url = env.AIPEX_WS_URL;"],
    ["AIPEX_CONNECT_TIMEOUT", "const ms = env.AIPEX_CONNECT_TIMEOUT;"],
    ["the fork's origin", "// github.com/AIPexStudio/AIPex"],
    ["the wrong npm package", "// never run npx -y aipex-mcp-bridge"],
  ]) {
    it(`passes ${name}, kept on purpose`, () => {
      const result = scan({ "src/kept.ts": `${line}\n` });
      assert.equal(result.status, 0, result.stderr);
    });
  }

  for (const token of [
    "aipex_theme",
    "aipex_language",
    "aipex_settings",
    "aipex_host_access_config",
    "aipex_automation_mode",
    "aipex_risky_origin_grants",
    "aipex_zenfs_migration_status",
    "aipex_zenfs_migration_v2_status",
    "aipex-input-mode",
    "aipex-sessions",
    "aipex_last_capture_event",
    "aipex-conversations",
    "aipex-conversations-db",
    "aipex-conversations-migrated",
    "aipex-screenshots-db",
    "aipex-skills-fs",
    "AIPexSkills",
    "new-aipex",
  ]) {
    it(`flags a name the AIPex-data migration used: ${token}`, () => {
      const result = scan({ "src/old.ts": `const NAME = "${token}";\n` });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /src\/old\.ts:1/);
    });
  }

  for (const line of [
    'export { AIPex } from "./aipex.js";',
    "export type { AIPexOptions };",
    'import type * as AIPexCore from "@apty/agent-core";',
    "// see aipex-retry.test.ts",
    'if (message.action === "aipex_open_omni") open();',
    'if (message.action === "aipex_close_omni") close();',
    'const DOM_SNAPSHOT_MESSAGE = "aipex:collect-dom-snapshot";',
    'const AIPEX_SCREENSHOT_URL_PREFIX = "https://x.invalid/";',
    "export class AIPex {}",
    "const agent = AIPex.create({ model });",
    "let agent: AIPex | undefined;",
    'const log = createLogger("AIPex");',
  ]) {
    it(`flags a name C1 removed: ${line}`, () => {
      const result = scan({ "src/back.ts": `${line}\n` });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /src\/back\.ts:1/);
    });
  }

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
