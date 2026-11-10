#!/usr/bin/env node
/**
 * Fails when a KB pack, or a file shaped like one, is in the tree. The
 * repository and its release zips are public, and a pack holds internal KB
 * card text (docs/tasks/kb-rag/MASTER.md, rule 2). A file fails when:
 *
 * - its name ends in `.kbpack.json`, or it is inside a directory whose name
 *   starts with `kb-pack` (the names .gitignore ignores), or
 * - it carries the pack's `kind` marker: the key `kind` set to the pack's
 *   kind string, quoted or not, escaped or not, so a pack pasted into a
 *   JSON, JS or TS file or bundled into dist is caught too.
 *
 * Code and tests name the kind through a constant, never as a `kind` key
 * with the literal string.
 *
 * It also fails on a source comment (`.ts`, `.tsx`, `.mjs` under packages/,
 * apps/ and tooling/) that quotes a phrase of four or more words with a
 * 10-digit page id on the same line, or, for a quote that runs over several
 * comment lines or ends at a line break, on a line it spans or just after
 * it: that is a card title, and a comment names a card by its page id and a
 * description in its own words. Only node_modules and .git are skipped: run it
 * after the build, so the extension's dist, which the release zips are
 * made from, is scanned as well. It prints paths and reasons, never a
 * file's contents.
 *
 * Usage: node tooling/scripts/check-no-kb-pack.mjs [root]
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PACK_KIND = "apty-kb-pack";
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const PACK_FILE = /\.kbpack\.json$/i;
const PACK_DIR = /^kb-pack/i;
const QUOTE = `\\\\?["'\`]`;
const MARKER = new RegExp(
  `(?<![\\w$])${QUOTE}?kind${QUOTE}?\\s*:\\s*${QUOTE}${PACK_KIND}${QUOTE}`,
);
/** The owner prompt quotes the schema, marker included; it holds no card text. */
const MARKER_ALLOWED = new Set(["docs/tasks/kb-rag/MASTER.md"]);

const SOURCE_ROOTS = ["packages", "apps", "tooling"];
const SOURCE_FILE = /\.(?:ts|tsx|mjs)$/;
const SOURCE_SKIP = new Set([...SKIP_DIRS, "dist"]);
const PAGE_ID = /(?<!\d)\d{10}(?!\d)/;
const QUOTED_PHRASE = /"([^"]+)"|'([^']+)'|“([^”]+)”|`([^`]+)`/g;
const LINE_COMMENT = /(?<![:\w])\/\/|\/\*/;

/** The comment part of a source line, or "" when it has none. */
function commentOf(line) {
  const trimmed = line.trimStart();
  if (/^(?:\*|\/\*|\/\/)/.test(trimmed)) return trimmed;
  const at = line.search(LINE_COMMENT);
  return at === -1 ? "" : line.slice(at);
}

/** Whether a source line's comment quotes a phrase of 4+ words next to a page id: a card title. */
export function quotesCardTitle(line) {
  const comment = commentOf(line);
  if (!PAGE_ID.test(comment)) return false;
  for (const match of comment.matchAll(QUOTED_PHRASE)) {
    const phrase = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    if (phrase.trim().split(/\s+/).filter(Boolean).length >= 4) return true;
  }
  return false;
}

const MULTI_LINE_QUOTE = /"([^"]{1,300})"|“([^”]{1,300})”|`([^`]{1,300})`/g;
/** How far after a closing quote a page id still names the quoted card. */
const ID_AFTER_QUOTE = 30;
const COMMENT_MARK = /^\s*(?:\/\*\*?|\*\/?|\/\/)?\s?|\s*\*\/\s*$/g;

const words = (phrase) => phrase.trim().split(/\s+/).filter(Boolean).length;

/**
 * The lines (1-based) where a comment quotes a card title: a quoted phrase
 * of 4+ words with a page id on its line (`quotesCardTitle`), or a quote
 * that runs over several comment lines, or is followed on the next one, by
 * a page id on a line it spans or just after it closes.
 */
export function cardTitleQuoteLines(source) {
  const lines = source.split("\n");
  const found = new Set();
  lines.forEach((line, i) => {
    if (quotesCardTitle(line)) found.add(i + 1);
  });
  let block = [];
  const flush = () => {
    if (block.length > 1) checkBlock(block, found);
    block = [];
  };
  lines.forEach((line, i) => {
    const comment = commentOf(line);
    if (comment)
      block.push({ line: i + 1, text: comment.replace(COMMENT_MARK, "") });
    else flush();
  });
  flush();
  return [...found].sort((a, b) => a - b);
}

/** A comment block's quotes that cross a line break, or end next to an id on the next line. */
function checkBlock(block, found) {
  const starts = [];
  let text = "";
  for (const { text: part } of block) {
    starts.push(text.length);
    text += `${part}\n`;
  }
  const lineAt = (offset) => {
    let index = 0;
    while (index + 1 < starts.length && starts[index + 1] <= offset) index++;
    return index;
  };
  for (const match of text.matchAll(MULTI_LINE_QUOTE)) {
    const phrase = match[1] ?? match[2] ?? match[3] ?? "";
    if (words(phrase) < 4) continue;
    const first = lineAt(match.index);
    const end = match.index + match[0].length;
    const last = lineAt(end - 1);
    const after = text.slice(end, end + ID_AFTER_QUOTE);
    const spanned = block
      .slice(first, last + 1)
      .some(({ text: part }) => PAGE_ID.test(part));
    const crosses = last > first || after.includes("\n");
    if (crosses && (spanned || PAGE_ID.test(after)))
      found.add(block[first].line);
  }
}

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SOURCE_SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isDirectory()) yield* sourceFiles(full);
    else if (stat.isFile() && SOURCE_FILE.test(entry)) yield full;
  }
}

/** Every source line under `root` whose comment quotes a card title: `{ path, reason }`, line numbers only. */
export function cardTitleCommentProblems(root) {
  const problems = [];
  for (const top of SOURCE_ROOTS) {
    for (const full of sourceFiles(join(root, top))) {
      const path = relative(root, full).split(sep).join("/");
      for (const line of cardTitleQuoteLines(readFileSync(full, "utf8"))) {
        problems.push({
          path: `${path}:${line}`,
          reason: "a comment quotes a card title next to a page id",
        });
      }
    }
  }
  return problems.sort((a, b) => a.path.localeCompare(b.path));
}

/** Whether `text` sets the pack's `kind` marker. */
export function hasPackMarker(text) {
  return MARKER.test(text);
}

function fileHasMarker(path) {
  const bytes = readFileSync(path);
  if (!bytes.includes(PACK_KIND)) return false;
  return hasPackMarker(bytes.toString("utf8"));
}

function* walk(root, dir, problems) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const path = relative(root, full).split(sep).join("/");
    const stat = lstatSync(full);
    if (stat.isDirectory()) {
      if (PACK_DIR.test(entry)) {
        problems.push({ path: `${path}/`, reason: "a kb-pack* directory" });
        continue;
      }
      yield* walk(root, full, problems);
    } else {
      yield { full, path, entry, followable: stat.isFile() };
    }
  }
}

/** Every file or directory under `root` that is, or looks like, a KB pack: `{ path, reason }`. */
export function kbPackProblems(root) {
  const problems = [];
  for (const { full, path, entry, followable } of walk(root, root, problems)) {
    if (PACK_FILE.test(entry)) {
      problems.push({ path, reason: "a *.kbpack.json file" });
    } else if (followable && !MARKER_ALLOWED.has(path) && fileHasMarker(full)) {
      problems.push({ path, reason: "carries the KB pack kind marker" });
    }
  }
  return problems.sort((a, b) => a.path.localeCompare(b.path));
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    process.argv[2] ?? fileURLToPath(new URL("../../", import.meta.url)),
  );
  const problems = kbPackProblems(root);
  const titles = cardTitleCommentProblems(root);
  if (titles.length > 0) {
    console.error(
      "Comments name a card by its page id and a description in your own words, never its title:",
    );
    for (const { path, reason } of titles)
      console.error(`  ${path}: ${reason}`);
    process.exitCode = 1;
  }
  if (problems.length > 0) {
    console.error(
      "KB packs hold internal card text and must never be in this public repository or its builds:",
    );
    for (const { path, reason } of problems) {
      console.error(`  ${path}: ${reason}`);
    }
    console.error(
      "Move them outside the repository (the builder writes to ~/apty-kb/ by default); tests build synthetic packs at run time.",
    );
    process.exitCode = 1;
  } else if (titles.length === 0) {
    console.log("✓ no KB pack in the tree");
  }
}
