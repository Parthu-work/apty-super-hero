import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  checkDocsLinks,
  headingAnchors,
  markdownLinks,
} from "./check-docs-links.mjs";

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "docs-links-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("headingAnchors", () => {
  it("follows GitHub: lower case, punctuation dropped, duplicates numbered, fences ignored", () => {
    assert.deepEqual(
      [
        ...headingAnchors(
          "# A `b`/C — d\n## Same\n## Same\n```\n# not a heading\n```",
        ),
      ],
      ["a-bc--d", "same", "same-1"],
    );
  });
});

describe("markdownLinks", () => {
  it("skips code spans and fences", () => {
    assert.deepEqual(
      markdownLinks(
        '[a](x.md) `[b](y.md)`\n```\n[c](z.md)\n```\n[d](<w.md> "t")',
      ).map((l) => l.target),
      ["x.md", "w.md"],
    );
  });
});

describe("checkDocsLinks", () => {
  it("reports missing files and headings, accepts good links and web links, skips the archive's own links", () => {
    const root = tree({
      "README.md":
        "[ok](docs/a.md#intro) [web](https://example.com) [self](#readme)\n# Readme",
      "docs/a.md":
        "# Intro\n[gone](missing.md) [bad anchor](../README.md#nope)",
      "docs/archive/old.md": "[stale](../../nowhere.md)",
    });
    assert.deepEqual(checkDocsLinks(root), [
      "docs/a.md:2: missing.md (no such file)",
      "docs/a.md:2: ../README.md#nope (no such heading)",
    ]);
  });
});
