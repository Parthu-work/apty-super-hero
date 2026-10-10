import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkTestSkips, unexplainedSkips } from "./check-test-skips.mjs";

const SCRIPT = fileURLToPath(
  new URL("./check-test-skips.mjs", import.meta.url),
);
// Built from parts so this file does not trip the check it tests.
const SKIP = (kind) => `${kind}.${"skip"}`;

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "check-test-skips-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("unexplainedSkips", () => {
  it("flags every kind of skip with no reason", () => {
    const source = [
      `${SKIP("it")}("a", () => {});`,
      `${SKIP("describe")}("b", () => {});`,
      `${SKIP("test")}If(true)("c", () => {});`,
      `${SKIP("suite")} ("d", () => {});`,
    ].join("\n");
    assert.deepEqual(unexplainedSkips(source), [1, 2, 3, 4]);
  });

  it("accepts a reason on the same line or the line above, but not two lines up or an empty one", () => {
    const source = [
      "// skip-reason: needs a real Client",
      `${SKIP("it")}("a", () => {});`,
      `${SKIP("it")}("b", () => {}); // skip-reason: flaky upstream, see #12`,
      "// skip-reason: too far away",
      "",
      `${SKIP("it")}("c", () => {});`,
      "// skip-reason:",
      `${SKIP("it")}("d", () => {});`,
    ].join("\n");
    assert.deepEqual(unexplainedSkips(source), [6, 8]);
  });

  it("ignores names that only contain skip", () => {
    assert.deepEqual(
      unexplainedSkips('it("skips nothing", () => skip());'),
      [],
    );
  });
});

describe("checkTestSkips and the CLI", () => {
  it("scans test files only, outside node_modules and dist, and fails the run", () => {
    const root = tree({
      "packages/a/src/x.test.ts": `\n${SKIP("it")}("x", () => {});\n`,
      "packages/a/src/y.ts": `${SKIP("it")}("not a test file", () => {});`,
      "node_modules/z/z.test.js": `${SKIP("it")}("vendored", () => {});`,
      "apps/b/dist/w.test.js": `${SKIP("it")}("built", () => {});`,
      "tooling/e2e/v.e2e.test.mjs": `// skip-reason: needs Chrome 140\n${SKIP("it")}("v", () => {});`,
    });
    assert.deepEqual(checkTestSkips(root), ["packages/a/src/x.test.ts:2"]);
    assert.throws(
      () => execFileSync("node", [SCRIPT, root], { stdio: "pipe" }),
      /packages\/a\/src\/x\.test\.ts:2/,
    );
  });

  it("passes when every skip says why", () => {
    const root = tree({
      "a.test.ts": `// skip-reason: x\n${SKIP("it")}("a", () => {});`,
    });
    assert.match(
      execFileSync("node", [SCRIPT, root], { encoding: "utf8" }),
      /every skipped test says why/,
    );
  });
});
