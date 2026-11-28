import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkRanges,
  GIT_IO,
  hashLines,
  missingForPhase,
  rehash,
  shapeProblems,
  unmappedFiles,
} from "./check-apty-coverage.mjs";

const SCRIPT = fileURLToPath(
  new URL("./check-apty-coverage.mjs", import.meta.url),
);

const git = (dir, ...args) =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();

/** A throwaway "apty-dap" with two commits: the second changes line 2 of the cited file. */
function fakeDap() {
  const dir = mkdtempSync(join(tmpdir(), "apty-coverage-"));
  git(dir, "init", "-q");
  const file = join(dir, "packages/player/segments.service.ts");
  mkdirSync(join(dir, "packages/player"), { recursive: true });
  writeFileSync(file, "a\nb\nc\nd\n");
  writeFileSync(join(dir, "packages/player/other.ts"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "one");
  const first = git(dir, "rev-parse", "HEAD");
  writeFileSync(file, "a\nB\nc\nd\n");
  git(dir, "commit", "-q", "-am", "two");
  const second = git(dir, "rev-parse", "HEAD");
  return { dir, first, second };
}

const entry = (ranges, extra = {}) => ({
  id: "W5-08",
  aliases: [],
  version: "5.x",
  condition: "The display mode is per environment.",
  decidedBy: "F",
  group: "Widget",
  status: "verified",
  ruleIds: ["WNV-07"],
  ranges,
  ...extra,
});

const range = (commit, from, to, extra = {}) => ({
  repo: "apty-dap",
  commit,
  path: "packages/player/segments.service.ts",
  from,
  to,
  ...extra,
});

test("hashes the cited lines, with line endings normalised, and nothing past the end", () => {
  assert.equal(hashLines("a\nb\nc", 2, 3), hashLines("a\r\nb\r\nc", 2, 3));
  assert.notEqual(hashLines("a\nb\nc", 1, 2), hashLines("a\nb\nc", 2, 3));
  assert.equal(hashLines("a\nb", 2, 3), undefined);
  assert.equal(hashLines("a\nb", 0, 1), undefined);
});

test("finds a malformed manifest: duplicate ids or aliases, bad ranges, no citation", () => {
  assert.deepEqual(
    shapeProblems({ conditions: [entry([range("c1", 1, 2)])] }),
    [],
  );
  const problems = shapeProblems({
    conditions: [
      entry([range("c1", 3, 2)]),
      entry([], { id: "W5-09", aliases: ["W5-08"] }),
      entry([{ ...range("c1", 1, 1), path: "/abs" }], { id: "W5-10" }),
      entry([], { id: "W5-11", status: "not_found" }),
    ],
  });
  assert.deepEqual(problems, [
    "conditions[0] (W5-08) range 0: lines 3-2",
    "conditions[1] (W5-09): W5-08 is listed twice",
    "conditions[1] (W5-09): no range cited",
    "conditions[2] (W5-10) range 0: path",
  ]);
  assert.deepEqual(shapeProblems({}), ["the manifest has no conditions list"]);
});

test("names a phase's conditions that have no entry, by id or alias", () => {
  const manifest = {
    phases: { 1: ["W5-08", "G5-12", "F4-07"] },
    conditions: [entry([], { aliases: ["G5-12"] })],
  };
  assert.deepEqual(missingForPhase(manifest, 1), ["F4-07"]);
  assert.deepEqual(missingForPhase(manifest, 2), [
    "phase 2 lists no conditions",
  ]);
});

test("passes unchanged lines, fails changed ones naming the rules, and skips old or newer code", () => {
  const { dir, first, second } = fakeDap();
  const manifest = {
    conditions: [
      entry([range(first, 3, 4), range(first, 1, 2)]),
      entry([range(first, 1, 2, { track: false })], { id: "W5-09" }),
      entry([range(second, 2, 2)], { id: "W5-10" }),
    ],
  };
  assert.deepEqual(rehash(manifest, { "apty-dap": dir }), []);

  const atFirst = checkRanges(
    manifest,
    { "apty-dap": dir },
    { "apty-dap": first },
    GIT_IO,
  );
  assert.deepEqual(
    atFirst.map((f) => [f.id, f.kind]),
    [["W5-10", "newer"]],
  );

  const atHead = checkRanges(manifest, { "apty-dap": dir }, {}, GIT_IO);
  assert.deepEqual(
    atHead.map((f) => [f.id, f.index, f.kind, f.ruleIds]),
    [["W5-08", 1, "changed", ["WNV-07"]]],
  );
});

test("names a cited file or lines that are gone, and a range with no hash yet", () => {
  const { dir, first } = fakeDap();
  const manifest = {
    conditions: [
      entry([
        range(first, 1, 1, {
          path: "packages/player/gone.ts",
          sha256: "0".repeat(64),
        }),
        range(first, 9, 9, { sha256: "0".repeat(64) }),
        range(first, 1, 1),
      ]),
    ],
  };
  assert.deepEqual(
    checkRanges(manifest, { "apty-dap": dir }, {}, GIT_IO).map((f) => [
      f.kind,
      f.detail,
    ]),
    [
      ["missing", "file not in HEAD"],
      ["missing", "lines past the end"],
      ["unhashed", undefined],
    ],
  );
});

test("lists files under the player's visibility directories that no range cites", () => {
  const manifest = {
    unmappedRoots: { "apty-dap": ["packages/player"] },
    conditions: [entry([range("c1", 1, 1)])],
  };
  assert.deepEqual(
    unmappedFiles(manifest, "apty-dap", [
      "packages/player/segments.service.ts",
      "packages/player/other.ts",
      "packages/player/other.test.ts",
      "packages/player/readme.md",
      "packages/admin/x.ts",
    ]),
    ["packages/player/other.ts"],
  );
});

test("the command fails on drift, passes at the pin, and skips without checkouts", () => {
  const { dir, first } = fakeDap();
  const manifestFile = join(
    mkdtempSync(join(tmpdir(), "apty-manifest-")),
    "m.json",
  );
  const manifest = {
    repos: { "apty-dap": { pinned: first } },
    phases: { 1: ["W5-08"] },
    conditions: [entry([range(first, 1, 2)])],
  };
  rehash(manifest, { "apty-dap": dir });
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const run = (...args) => {
    try {
      return {
        code: 0,
        out: execFileSync(
          "node",
          [SCRIPT, "--manifest", manifestFile, ...args],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, APTY_DAP_DIR: "", APTY_ASSIST_DIR: "" },
          },
        ),
      };
    } catch (error) {
      return { code: error.status, out: `${error.stdout}${error.stderr}` };
    }
  };
  const missingDir = join(tmpdir(), "no-such-checkout");
  const none = run("--dap", missingDir, "--assist", missingDir, "--phase", "1");
  assert.equal(none.code, 0);
  assert.match(none.out, /skipped: no checkout/);

  const drift = run("--dap", dir, "--assist", missingDir);
  assert.equal(drift.code, 1);
  assert.match(drift.out, /changed: W5-08 \(rules WNV-07\)/);

  const pinned = run("--dap", dir, "--assist", missingDir, "--pinned");
  assert.equal(pinned.code, 0, pinned.out);
});
