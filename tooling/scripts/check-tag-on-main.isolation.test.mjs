/**
 * check-tag-on-main.test.mjs builds a scratch repository with git. Run from
 * a git hook (the pre-push hook runs every script test), GIT_DIR and its
 * siblings point at the repository being pushed, and a git command that
 * inherits them writes there instead of into the scratch repository.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(
  new URL("./check-tag-on-main.test.mjs", import.meta.url),
);

const outer = mkdtempSync(join(tmpdir(), "tag-on-main-outer-"));
after(() => rmSync(outer, { recursive: true, force: true }));

const outerGit = (...args) =>
  spawnSync("git", args, { cwd: outer, encoding: "utf8" });

it("leaves the repository a git hook runs in untouched", () => {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: outer });
  const configBefore = outerGit("config", "--local", "--list").stdout;

  const { NODE_TEST_CONTEXT: _child, ...env } = process.env;
  const run = spawnSync(process.execPath, ["--test", testFile], {
    encoding: "utf8",
    env: {
      ...env,
      GIT_DIR: join(outer, ".git"),
      GIT_WORK_TREE: outer,
      GIT_INDEX_FILE: join(outer, ".git", "index"),
    },
  });

  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(outerGit("config", "--local", "--list").stdout, configBefore);
  assert.equal(outerGit("rev-parse", "--verify", "--quiet", "HEAD").status, 1);
});
