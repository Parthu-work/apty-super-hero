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
 * with the literal string. Only node_modules and .git are skipped: run it
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
  } else {
    console.log("✓ no KB pack in the tree");
  }
}
