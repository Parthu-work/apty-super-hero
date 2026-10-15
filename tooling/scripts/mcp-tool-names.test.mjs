/**
 * The extension refuses MCP calls to tools outside its MCP list, and the
 * daemon forwards only the tools it publishes. The two lists must match,
 * or a published tool would fail at the extension.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("the extension's MCP tool list equals the daemon's published tools", () => {
  const published = [
    ...read("apps/mcp-bridge/src/tool-schemas.ts").matchAll(
      /^\s{4}name: "([a-z_]+)"/gm,
    ),
  ].map((m) => m[1]);
  const exposed = [
    ...read(
      "packages/browser-runtime/src/ws-bridge/mcp-tool-names.ts",
    ).matchAll(/^\s{2}"([a-z_]+)",$/gm),
  ].map((m) => m[1]);

  assert.ok(published.length > 0);
  assert.deepEqual([...exposed].sort(), [...published].sort());
});
