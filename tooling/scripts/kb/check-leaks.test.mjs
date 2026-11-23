/**
 * KB-RAG K29 P4: the leak check finds a card title or symptom line from a
 * pack in a tracked file and names the file, the line and the page id
 * only. Synthetic packs only; the phrases are joined at run time, so this
 * file never holds them whole.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { cardPhrases, findLeaks, run } from "./check-leaks.mjs";

const words = (...list) => list.join(" ");
const TITLE = words("Zorblax", "quantum", "tooltip", "refuses", "activation");
const SYMPTOM = words("the", "zorblax", "balloon", "melts", "on", "hover");

function writePack(dir, name = "synthetic.kbpack.json") {
  const file = join(dir, name);
  writeFileSync(
    file,
    JSON.stringify({
      cards: [
        { pageId: "9001", title: TITLE, symptom: SYMPTOM },
        { pageId: "9002", title: words("Zorblax", "badge"), symptom: null },
      ],
    }),
  );
  return file;
}

describe("check-leaks", () => {
  it("keeps titles and symptom lines of four words or more, normalised", () => {
    const phrases = cardPhrases([
      {
        cards: [
          {
            pageId: "9001",
            title: `  ${TITLE.toUpperCase()} `,
            symptom: SYMPTOM,
          },
          { pageId: "9002", title: words("Zorblax", "badge"), symptom: null },
        ],
      },
    ]);
    assert.deepEqual(phrases, [
      { pageId: "9001", phrase: TITLE.toLowerCase() },
      { pageId: "9001", phrase: SYMPTOM.toLowerCase() },
    ]);
  });

  it("finds one planted title with its file, line and page id", () => {
    const root = mkdtempSync(join(tmpdir(), "apty-leaks-"));
    writeFileSync(join(root, "clean.md"), "Nothing to see.\n");
    writeFileSync(
      join(root, "planted.md"),
      `# Notes\n\nThe card ${TITLE.replace(/ /g, "  ")} came first.\n`,
    );
    const hits = findLeaks({
      root,
      files: ["clean.md", "planted.md"],
      phrases: cardPhrases([
        { cards: [{ pageId: "9001", title: TITLE, symptom: null }] },
      ]),
    });
    assert.deepEqual(hits, [{ file: "planted.md", line: 3, pageId: "9001" }]);
  });

  it("finds a title wrapped over two lines at the line it starts on, once", () => {
    const root = mkdtempSync(join(tmpdir(), "apty-leaks-"));
    const [first, ...rest] = TITLE.split(" ");
    writeFileSync(
      join(root, "wrapped.md"),
      `Intro line.\nThe card ${first} ${rest[0]}\n${rest.slice(1).join(" ")} came\nfirst.\n`,
    );
    assert.deepEqual(
      findLeaks({
        root,
        files: ["wrapped.md"],
        phrases: cardPhrases([
          { cards: [{ pageId: "9001", title: TITLE, symptom: null }] },
        ]),
      }),
      [{ file: "wrapped.md", line: 2, pageId: "9001" }],
    );
  });

  it("prints file, line and id only, and exits 1 on a hit", () => {
    const root = mkdtempSync(join(tmpdir(), "apty-leaks-"));
    const packs = mkdtempSync(join(tmpdir(), "apty-leaks-packs-"));
    writeFileSync(join(root, "a.ts"), `const x = "${SYMPTOM}";\n`);
    const lines = [];
    const code = run({
      argv: ["--pack", writePack(packs)],
      root,
      files: ["a.ts"],
      out: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    const text = lines.join("\n");
    assert.match(text, /^a\.ts:1 page 9001$/m);
    assert.ok(!text.toLowerCase().includes("zorblax"), "no card text printed");
  });

  it("finds nothing in this repository's tracked files", () => {
    const lines = [];
    const code = run({
      argv: ["--pack", writePack(mkdtempSync(join(tmpdir(), "apty-leaks-")))],
      out: (line) => lines.push(line),
    });
    assert.equal(code, 0, lines.join("\n"));
    assert.match(
      lines.join("\n"),
      /No card title or symptom line in \d+ tracked files/,
    );
  });

  it("needs at least one --pack and names an unreadable one", () => {
    const lines = [];
    assert.equal(run({ argv: [], out: (l) => lines.push(l) }), 2);
    assert.match(lines.join("\n"), /--pack/);
    assert.equal(
      run({
        argv: ["--pack", join(tmpdir(), "missing-pack.json")],
        out: () => {},
      }),
      2,
    );
  });
});
