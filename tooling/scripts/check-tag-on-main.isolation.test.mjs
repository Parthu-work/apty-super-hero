/**
 * check-tag-on-main.test.mjs builds a scratch repository with git. Run from
 * a git hook (the pre-push hook runs every script test), GIT_DIR and its
 * siblings point at the repository being pushed, and a git command that
 * inherits them writes there instead of into the scratch repository. This
 * file's own git calls drop every GIT_* variable for the same reason.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(
  new URL("./check-tag-on-main.test.mjs", import.meta.url),
);
const thisFile = fileURLToPath(import.meta.url);
const NESTED = "APTY_TAG_ON_MAIN_ISOLATION_NESTED";

function cleanGitEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
}

function childEnv(gitDir, workTree) {
  const { NODE_TEST_CONTEXT: _child, ...env } = cleanGitEnv();
  return {
    ...env,
    GIT_DIR: gitDir,
    GIT_WORK_TREE: workTree,
    GIT_INDEX_FILE: join(gitDir, "index"),
  };
}

const gitIn = (cwd, ...args) =>
  spawnSync("git", args, { cwd, encoding: "utf8", env: cleanGitEnv() });

const outer = mkdtempSync(join(tmpdir(), "tag-on-main-outer-"));
after(() => rmSync(outer, { recursive: true, force: true }));

it("leaves the repository a git hook runs in untouched", () => {
  execFileSync("git", ["init", "-q", "-b", "main"], {
    cwd: outer,
    env: cleanGitEnv(),
  });
  const configBefore = gitIn(outer, "config", "--local", "--list").stdout;

  const run = spawnSync(process.execPath, ["--test", testFile], {
    encoding: "utf8",
    env: childEnv(join(outer, ".git"), outer),
  });

  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(
    gitIn(outer, "config", "--local", "--list").stdout,
    configBefore,
  );
  assert.equal(
    gitIn(outer, "rev-parse", "--verify", "--quiet", "HEAD").status,
    1,
  );
});

if (!process.env[NESTED]) {
  it("keeps its own git commands out of the repository a linked worktree's hook runs it from", () => {
    const hooked = mkdtempSync(join(tmpdir(), "tag-on-main-hooked-"));
    try {
      const repo = join(hooked, "repo");
      const workTree = join(hooked, "worktree");
      mkdirSync(repo);
      mkdirSync(workTree);
      execFileSync("git", ["init", "-q", "-b", "main"], {
        cwd: repo,
        env: cleanGitEnv(),
      });
      const configBefore = gitIn(repo, "config", "--local", "--list").stdout;

      const run = spawnSync(process.execPath, ["--test", thisFile], {
        encoding: "utf8",
        env: { ...childEnv(join(repo, ".git"), workTree), [NESTED]: "1" },
      });

      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(
        gitIn(repo, "config", "--local", "--list").stdout,
        configBefore,
      );
      assert.equal(
        gitIn(repo, "rev-parse", "--verify", "--quiet", "HEAD").status,
        1,
      );
    } finally {
      rmSync(hooked, { recursive: true, force: true });
    }
  });
}
