#!/usr/bin/env node
/**
 * Keeps real card text out of this public repository (KB-RAG K29, P4).
 * Reads the KB packs (kept outside the repository) and scans every
 * git-tracked file for any card title or symptom line of four words or more,
 * case-insensitive and whitespace-normalised. It prints the file, line and
 * page id of each hit, never the text.
 *
 * Usage: pnpm kb:check-leaks --pack <file> [--pack <file> ...]
 * Exits 1 on any hit, 2 on a usage error or an unreadable pack.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIN_WORDS = 4;

const normalise = (text) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Each card's title and symptom line of at least four words, normalised, by page id. */
export function cardPhrases(packs) {
  const phrases = [];
  for (const pack of packs) {
    for (const card of pack.cards ?? []) {
      for (const text of [card.title, card.symptom]) {
        if (typeof text !== "string") continue;
        const phrase = normalise(text);
        if (phrase.split(" ").length >= MIN_WORDS) {
          phrases.push({ pageId: String(card.pageId), phrase });
        }
      }
    }
  }
  return phrases;
}

function trackedFiles(root) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function readText(path) {
  try {
    const bytes = readFileSync(path);
    return bytes.includes(0) ? undefined : bytes.toString("utf8");
  } catch {
    return undefined;
  }
}

const WRAP_LINES = 3;

/**
 * Each line where a phrase starts, also when the phrase wraps onto the next
 * lines (Markdown is wrapped): a phrase is reported at the first line of the
 * shortest run of lines that holds it.
 */
export function findLeaks({ root, files, phrases }) {
  const hits = [];
  if (phrases.length === 0) return hits;
  for (const file of files) {
    const text = readText(join(root, file));
    if (text === undefined) continue;
    const whole = normalise(text);
    const present = phrases.filter(({ phrase }) => whole.includes(phrase));
    if (present.length === 0) continue;
    const lines = text.split("\n");
    const span = (from, count) =>
      normalise(lines.slice(from, from + count).join(" "));
    lines.forEach((_, i) => {
      const seen = new Set();
      for (const { pageId, phrase } of present) {
        if (seen.has(pageId)) continue;
        const starts = Array.from({ length: WRAP_LINES }, (_, n) => n + 1).some(
          (count) =>
            span(i, count).includes(phrase) &&
            !span(i + 1, count - 1).includes(phrase),
        );
        if (starts) {
          seen.add(pageId);
          hits.push({ file, line: i + 1, pageId });
        }
      }
    });
  }
  return hits;
}

function parseArgs(argv) {
  const packs = [];
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] !== "--pack" || argv[i + 1] === undefined) {
      throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    }
    packs.push(argv[i + 1]);
  }
  if (packs.length === 0) throw new Error("Give --pack <file> for each pack.");
  return packs;
}

export function run({
  argv = process.argv.slice(2),
  root = REPO_ROOT,
  files,
  out = console.log,
} = {}) {
  let packs;
  try {
    packs = parseArgs(argv).map((path) => {
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch {
        throw new Error(`Cannot read the pack ${path}.`);
      }
    });
  } catch (error) {
    out(
      `${error.message}\nUsage: pnpm kb:check-leaks --pack <file> [--pack <file> ...]`,
    );
    return 2;
  }
  const scanned = files ?? trackedFiles(root);
  const hits = findLeaks({ root, files: scanned, phrases: cardPhrases(packs) });
  for (const { file, line, pageId } of hits)
    out(`${file}:${line} page ${pageId}`);
  if (hits.length > 0) {
    out(
      `${hits.length} line${hits.length === 1 ? "" : "s"} hold a card title or symptom line: replace each with its page id.`,
    );
    return 1;
  }
  out(`No card title or symptom line in ${scanned.length} tracked files.`);
  return 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = run();
}
