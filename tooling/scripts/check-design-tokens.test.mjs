import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { countRules, stripComments } from "./check-design-tokens.mjs";

const script = fileURLToPath(
  new URL("./check-design-tokens.mjs", import.meta.url),
);

function run(files) {
  const root = mkdtempSync(join(tmpdir(), "design-tokens-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    return spawnSync(process.execPath, [script, "--root", root], {
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const UI = "packages/ui/src/components/widget.tsx";

describe("check-design-tokens", () => {
  for (const [rule, line] of [
    ["palette", '<p className="text-green-600 dark:bg-gray-900/50" />'],
    ["hex", 'const style = { color: "#2563eb" };'],
    ["rgb-hsl", 'const glow = "rgba(59, 130, 246, 0.4)";'],
    ["arbitrary-text-size", '<span className="text-[11px]" />'],
    ["large-text-size", '<h1 className="md:text-2xl" />'],
    ["heavy-weight", '<b className="font-bold" />'],
    ["uppercase", '<span className="uppercase" />'],
    ["tracking", '<span className="tracking-wide" />'],
  ]) {
    it(`flags ${rule}: ${line}`, () => {
      assert.ok(countRules(line)[rule] >= 1, JSON.stringify(countRules(line)));
      const result = run({ [UI]: `${line}\n` });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, new RegExp(`${rule}: ${UI}: \\d+\\n`));
    });
  }

  for (const [what, line] of [
    [
      "design tokens",
      '<p className="bg-warning-muted text-warning text-small font-semibold" />',
    ],
    ["an anchor or an issue number", 'const a = "#preflight"; // see #1234'],
    ["an HTML entity", 'const nbsp = "&#160;";'],
    ["toUpperCase", "const id = name.toUpperCase();"],
    [
      "a comment about text-red-600",
      "/* was text-red-600 and font-bold */\nconst x = 1;",
    ],
    ["a URL", 'const u = "https://example.com//text-[11px]";'],
  ]) {
    it(`passes ${what}`, () => {
      assert.deepEqual(countRules(line), {}, JSON.stringify(countRules(line)));
    });
  }

  it("keeps a // that follows a colon, as in a URL", () => {
    assert.equal(
      stripComments('const u = "https://x.test"; // note'),
      'const u = "https://x.test"; ',
    );
  });

  it("ignores tests and what is drawn outside the extension's stylesheet", () => {
    const literal =
      'const color = "rgba(59, 130, 246, 0.4)"; // #3b82f6\nconst c = "#22c55e";\n';
    const result = run({
      "packages/ui/src/components/widget.test.tsx": '"text-red-600"\n',
      "apps/browser-extension/src/entrypoints/content/index.tsx": literal,
      "apps/browser-extension/src/entrypoints/content/element-capture.ts":
        literal,
      "packages/ui/src/components/fake-mouse/fake-mouse.tsx": literal,
      "packages/ui/src/components/fake-mouse/types.ts": literal,
      "apps/browser-extension/src/entrypoints/background/mcp-bridge.ts":
        literal,
      [UI]: '<p className="text-sm" />\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no hard-coded colours or sizes/);
  });

  it("still checks the rest of the content script", () => {
    const result = run({
      "apps/browser-extension/src/entrypoints/content/frame-responder.ts":
        'const c = "#22c55e";\n',
    });
    assert.equal(result.status, 1);
  });

  it("tolerates nothing, even a baseline file left behind", () => {
    const result = run({
      [UI]: '"tracking-wide text-[11px]"\n',
      "tooling/scripts/design-tokens-baseline.json": JSON.stringify({
        tracking: { [UI]: 1 },
        "arbitrary-text-size": { [UI]: 1 },
      }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`arbitrary-text-size: ${UI}: 1\\n`));
    assert.match(result.stderr, new RegExp(`tracking: ${UI}: 1\\n`));
  });
});
