import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scratchGitEnv } from "./scratch-git-env.mjs";

const SCRIPT = fileURLToPath(new URL("./release-dry-run.sh", import.meta.url));
const IDENTITY = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.invalid",
];
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
  const git = gitIn(dir);
  git("init", "-q");
  git("add", ".");
  git(...IDENTITY, "commit", "-qm", "fixture");
  return dir;
}

function gitIn(cwd) {
  return (...args) => {
    const run = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      env: scratchGitEnv(),
    });
    assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
    return run.stdout;
  };
}

const dryRun = (dir, ...args) =>
  spawnSync(
    "bash",
    [join(dir, "tooling/scripts/release-dry-run.sh"), ...args],
    {
      cwd: dir,
      encoding: "utf8",
      env: scratchGitEnv(),
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

describe("release-dry-run.sh tests inside a git hook", () => {
  /** A repository with a linked worktree, as `git worktree add` leaves it. */
  function hookedRepo() {
    const root = mkdtempSync(join(tmpdir(), "apty-release-dry-run-hooked-"));
    dirs.push(root);
    const main = join(root, "main");
    mkdirSync(main);
    const git = gitIn(main);
    git("init", "-q", "-b", "main");
    git(...IDENTITY, "commit", "-q", "--allow-empty", "-m", "base");
    git("worktree", "add", "-q", join(root, "worktree"));
    const gitDir = join(main, ".git/worktrees/worktree");
    const state = () => ({
      config: readFileSync(join(main, ".git/config"), "utf8"),
      refs: git("for-each-ref"),
      worktreeIndex: readFileSync(join(gitDir, "index")).toString("base64"),
    });
    return { gitDir, state };
  }

  function withEnv(vars, fn) {
    const saved = Object.fromEntries(
      Object.keys(vars).map((name) => [name, process.env[name]]),
    );
    Object.assign(process.env, vars);
    try {
      return fn();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }

  it("uses the throwaway repository when GIT_DIR names a linked worktree's", () => {
    const hooked = hookedRepo();
    const before = hooked.state();

    const run = withEnv({ GIT_DIR: hooked.gitDir, GIT_PREFIX: "" }, () => {
      const dir = repo();
      writeFileSync(join(dir, "stray.txt"), "FIXTURE");
      return dryRun(dir, "--skip-e2e");
    });

    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /^Uncommitted or untracked files: stray\.txt \(/);
    assert.deepEqual(hooked.state(), before);
  });
});
