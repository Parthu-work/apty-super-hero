import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { countRules, stripComments } from "./check-design-tokens.mjs";

const script = fileURLToPath(
  new URL("./check-design-tokens.mjs", import.meta.url),
);

function run(files, { baseline, args = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "design-tokens-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const baselinePath = join(root, "baseline.json");
    if (baseline) writeFileSync(baselinePath, JSON.stringify(baseline));
    const result = spawnSync(
      process.execPath,
      [script, "--root", root, "--baseline", baselinePath, ...args],
      { encoding: "utf8" },
    );
    const written = existsSync(baselinePath)
      ? JSON.parse(readFileSync(baselinePath, "utf8"))
      : undefined;
    return { ...result, written };
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
      assert.match(
        result.stderr,
        new RegExp(`${rule}: ${UI}: \\d+ \\(allowed 0\\)`),
      );
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

  it("ignores tests and the content script's host-page overlay", () => {
    const result = run({
      "packages/ui/src/components/widget.test.tsx": '"text-red-600"\n',
      "apps/browser-extension/src/entrypoints/content/index.tsx":
        'const glow = "rgba(59, 130, 246, 0.4)";\n',
      [UI]: '<p className="text-sm" />\n',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no hard-coded colours or sizes/);
  });

  it("allows what the baseline allows, per rule and file, and no more", () => {
    const files = { [UI]: '"text-[11px] text-[10px]"\n' };
    const at = run(files, {
      baseline: { "arbitrary-text-size": { [UI]: 2 } },
    });
    assert.equal(at.status, 0, at.stderr);
    const below = run(files, {
      baseline: { "arbitrary-text-size": { [UI]: 1 } },
    });
    assert.equal(below.status, 1);
    const otherRule = run(files, { baseline: { uppercase: { [UI]: 2 } } });
    assert.equal(otherRule.status, 1);
  });

  it("lowers the baseline with --update, never raises it", () => {
    const lowered = run(
      { [UI]: '"uppercase"\n' },
      { baseline: { uppercase: { [UI]: 3 } }, args: ["--update"] },
    );
    assert.equal(lowered.status, 0, lowered.stderr);
    assert.deepEqual(lowered.written, { uppercase: { [UI]: 1 } });

    const raised = run(
      { [UI]: '"uppercase uppercase"\n' },
      { baseline: { uppercase: { [UI]: 1 } }, args: ["--update"] },
    );
    assert.equal(raised.status, 1);
    assert.deepEqual(raised.written, { uppercase: { [UI]: 1 } });
  });

  it("tolerates nothing, and creates no baseline, once the file is gone", () => {
    const result = run({ [UI]: '"tracking-wide"\n' }, { args: ["--update"] });
    assert.equal(result.status, 1);
    assert.equal(result.written, undefined);
  });
});
