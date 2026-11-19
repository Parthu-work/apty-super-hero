import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./release-dry-run.sh", import.meta.url));
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repository holding only the dry-run script, committed. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "apty-release-dry-run-"));
  dirs.push(dir);
  mkdirSync(join(dir, "tooling/scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(dir, "tooling/scripts/release-dry-run.sh"));
  const git = (...args) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return dir;
}

const dryRun = (dir, ...args) =>
  spawnSync(
    "bash",
    [join(dir, "tooling/scripts/release-dry-run.sh"), ...args],
    {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    },
  );

describe("release-dry-run.sh on a dirty tree (KB-RAG K28, F8)", () => {
  it("stops first and names the stray files", () => {
    const dir = repo();
    writeFileSync(join(dir, "stray.txt"), "FIXTURE");
    const run = dryRun(dir, "--skip-e2e");
    assert.equal(run.status, 1);
    assert.match(
      run.stderr,
      /^Uncommitted or untracked files: stray\.txt \(the format check reads the whole tree\)/,
    );
    assert.doesNotMatch(run.stdout, /Release dry run for/);
  });

  it("runs anyway with --allow-dirty", () => {
    const dir = repo();
    writeFileSync(join(dir, "stray.txt"), "FIXTURE");
    const run = dryRun(dir, "--allow-dirty", "--skip-e2e");
    assert.doesNotMatch(run.stderr, /Uncommitted or untracked files/);
    assert.match(run.stdout, /Release dry run for/);
  });

  it("refuses an unknown option", () => {
    const run = dryRun(repo(), "--publish");
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Unknown option: --publish/);
  });
});
