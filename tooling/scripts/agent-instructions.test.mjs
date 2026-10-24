/**
 * AGENTS.md (read by Codex-style agents) and CLAUDE.md (read by Claude
 * Code) carry the same instructions. CLAUDE.md is a symlink to AGENTS.md,
 * so they can't drift; this fails if CLAUDE.md is replaced by a separate
 * file that differs, or points somewhere else.
 */
import assert from "node:assert/strict";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { test } from "node:test";

const path = (name) => new URL(`../../${name}`, import.meta.url);

test("CLAUDE.md has the same instructions as AGENTS.md", () => {
  if (lstatSync(path("CLAUDE.md")).isSymbolicLink()) {
    assert.match(
      readlinkSync(path("CLAUDE.md")),
      /^(\.\/)?AGENTS\.md$/,
      "CLAUDE.md must link to AGENTS.md.",
    );
  }
  const agents = readFileSync(path("AGENTS.md"), "utf8").split("\n");
  const claude = readFileSync(path("CLAUDE.md"), "utf8").split("\n");
  const lines = Math.max(agents.length, claude.length);
  const first = Array.from({ length: lines }, (_, i) => i).find(
    (i) => agents[i] !== claude[i],
  );
  assert.equal(
    first,
    undefined,
    `AGENTS.md and CLAUDE.md differ from line ${first + 1}. Edit ` +
      "AGENTS.md, and make CLAUDE.md a symlink to it again " +
      "(ln -sf AGENTS.md CLAUDE.md), or make the same edit in both.",
  );
});
