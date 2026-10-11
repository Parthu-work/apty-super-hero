#!/usr/bin/env node
/**
 * Fails on a broken relative link in any Markdown file (D5): a link to a
 * file that does not exist, or to a heading anchor that the target does
 * not have. Web links, mailto: and links inside code are not checked.
 * docs/archive/ holds documents moved there verbatim; their own links are
 * not checked, but links into them are.
 *
 * Usage: node tooling/scripts/check-docs-links.mjs [root]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".claude",
]);
const UNCHECKED_SOURCES = [/^docs\/archive\//];

function* markdownFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* markdownFiles(full);
    else if (extname(entry) === ".md") yield full;
  }
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens, duplicates numbered. */
export function headingAnchors(markdown) {
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** `[text](target)` links outside code spans and fences, with their line numbers. */
export function markdownLinks(markdown) {
  const links = [];
  let inFence = false;
  markdown.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const withoutCode = line.replace(/`[^`]*`/g, "");
    for (const match of withoutCode.matchAll(
      /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
    )) {
      links.push({ target: match[1], line: index + 1 });
    }
  });
  return links;
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    anchorCache.set(file, headingAnchors(readFileSync(file, "utf8")));
  }
  return anchorCache.get(file);
}

export function checkDocsLinks(root) {
  const problems = [];
  for (const file of markdownFiles(root)) {
    const rel = relative(root, file);
    if (UNCHECKED_SOURCES.some((pattern) => pattern.test(rel))) continue;
    for (const { target, line } of markdownLinks(readFileSync(file, "utf8"))) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const [pathPart, anchor] = target.split("#");
      const resolved = pathPart
        ? resolve(dirname(file), decodeURIComponent(pathPart))
        : file;
      if (!existsSync(resolved)) {
        problems.push(`${rel}:${line}: ${target} (no such file)`);
        continue;
      }
      if (
        anchor &&
        extname(resolved) === ".md" &&
        !anchorsOf(resolved).has(decodeURIComponent(anchor).toLowerCase())
      ) {
        problems.push(`${rel}:${line}: ${target} (no such heading)`);
      }
    }
  }
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url)),
  );
  const problems = checkDocsLinks(root);
  if (problems.length > 0) {
    console.error(`Broken links (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("✓ every relative link in the Markdown files resolves");
  }
}
