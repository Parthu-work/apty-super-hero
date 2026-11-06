import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { hasPackMarker, kbPackProblems } from "./check-no-kb-pack.mjs";

const SCRIPT = fileURLToPath(
  new URL("./check-no-kb-pack.mjs", import.meta.url),
);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// Built from parts so this file does not trip the check it tests.
const KIND = ["apty", "kb", "pack"].join("-");
const CARD_TEXT = "FIXTURE: turn on the invented Glowing Banner setting";
const PACK = JSON.stringify(
  {
    kind: KIND,
    schemaVersion: 1,
    cards: [{ pageId: "1", title: "FIXTURE card" }],
    chunks: [{ id: "1#L1", pageId: "1", layer: 1, text: CARD_TEXT }],
  },
  null,
  2,
);

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "check-no-kb-pack-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("hasPackMarker", () => {
  it("finds the marker as JSON, as a JS object, escaped in a string and across lines", () => {
    assert.ok(hasPackMarker(PACK));
    assert.ok(hasPackMarker(`const p={kind:"${KIND}",schemaVersion:1}`));
    assert.ok(hasPackMarker(`export const p = { kind: '${KIND}' };`));
    assert.ok(hasPackMarker(`JSON.parse("{\\"kind\\":\\"${KIND}\\"}")`));
    assert.ok(hasPackMarker(`{"kind":\n  "${KIND}"}`));
  });

  it("ignores the kind named as a constant, in prose or under another key", () => {
    assert.ok(!hasPackMarker(`export const KB_PACK_KIND = "${KIND}";`));
    assert.ok(!hasPackMarker(`kind: z.literal(KB_PACK_KIND)`));
    assert.ok(!hasPackMarker(`A pack's kind is ${KIND}.`));
    assert.ok(!hasPackMarker(`{ subkind: "${KIND}" }`));
    assert.ok(!hasPackMarker(`{ "kind": "${KIND}-notes" }`));
  });
});

describe("kbPackProblems", () => {
  it("flags a pack by its marker whatever its name, including in a build's dist", () => {
    const root = tree({
      "data/cards.json": PACK,
      "apps/browser-extension/dist/assets/chunk.js": `var a={kind:"${KIND}"};`,
      "src/pack.ts": `export const KB_PACK_KIND = "${KIND}";`,
    });
    assert.deepEqual(kbPackProblems(root), [
      {
        path: "apps/browser-extension/dist/assets/chunk.js",
        reason: "carries the KB pack kind marker",
      },
      { path: "data/cards.json", reason: "carries the KB pack kind marker" },
    ]);
  });

  it("flags the ignored names even with no marker, and only directories for kb-pack*", () => {
    const root = tree({
      "apty-kb-JA-20261104.kbpack.json": "{}",
      "notes/Old.KBPACK.JSON": "",
      "kb-pack-2026/readme.txt": "nothing here",
      "tooling/kb-pack/x.json": "{}",
      "packages/browser-runtime/src/storage/kb-pack-store.ts": "export {};",
    });
    assert.deepEqual(
      kbPackProblems(root).map(({ path }) => path),
      [
        "apty-kb-JA-20261104.kbpack.json",
        "kb-pack-2026/",
        "notes/Old.KBPACK.JSON",
        "tooling/kb-pack/",
      ],
    );
  });

  it("skips node_modules and .git, and lets the owner prompt quote the marker", () => {
    const root = tree({
      "node_modules/x/pack.json": PACK,
      ".git/objects/pack.json": PACK,
      "docs/tasks/kb-rag/MASTER.md": `kind: "${KIND}";`,
      "docs/tasks/kb-rag/other.md": `kind: "${KIND}";`,
    });
    assert.deepEqual(
      kbPackProblems(root).map(({ path }) => path),
      ["docs/tasks/kb-rag/other.md"],
    );
  });
});

describe("the CLI", () => {
  it("fails on a pack, naming the path but never printing its text", () => {
    const root = tree({ "fixtures/pack.json": PACK });
    const run = spawnSync("node", [SCRIPT, root], { encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /fixtures\/pack\.json: carries the KB pack kind/);
    assert.ok(!run.stderr.includes(CARD_TEXT));
    assert.ok(!run.stdout.includes(CARD_TEXT));
  });

  it("passes on a clean tree", () => {
    const root = tree({ "README.md": "# Hello" });
    assert.match(
      execFileSync("node", [SCRIPT, root], { encoding: "utf8" }),
      /no KB pack in the tree/,
    );
  });
});

describe(".gitignore", () => {
  const ignored = (path) =>
    spawnSync("git", ["check-ignore", "--no-index", "-q", path], {
      cwd: ROOT,
    }).status === 0;

  it("ignores the names the check fails on, and not kb-pack-store.ts", () => {
    assert.ok(ignored("apty-kb-JA-20261104.kbpack.json"));
    assert.ok(ignored("tooling/scripts/kb/out.kbpack.json"));
    assert.ok(ignored("kb-pack-2026/cards.json"));
    assert.ok(ignored("tooling/kb-pack/cards.json"));
    assert.ok(
      !ignored("packages/browser-runtime/src/storage/kb-pack-store.ts"),
    );
  });
});
