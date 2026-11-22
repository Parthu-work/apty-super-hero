import { execFileSync } from "node:child_process";

const repositoryVars = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

/**
 * The environment without the variables that point git at a repository
 * (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...). A git hook exports them, and
 * a git command that inherits them in a scratch directory works on the
 * hooked repository instead: from a linked worktree, `git init` rewrites its
 * config and `git commit` commits to it.
 */
export function scratchGitEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !repositoryVars.includes(name)),
  );
}
