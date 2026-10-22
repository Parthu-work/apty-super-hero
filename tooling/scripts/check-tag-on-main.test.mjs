import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./check-tag-on-main.mjs", import.meta.url),
);

// Inside a git hook, GIT_DIR and its siblings point at the repository being
// pushed; dropped here, so every git command uses the scratch repository.
const localVars = execFileSync("git", ["rev-parse", "--local-env-vars"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !localVars.includes(name)),
);

let repo;
const git = (...args) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env }).trim();
const commit = (message) => {
  writeFileSync(join(repo, "file.txt"), message);
  git("add", "file.txt");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
};
const check = (sha, ref = "main") =>
  spawnSync(process.execPath, [script, sha, ref], {
    cwd: repo,
    encoding: "utf8",
    env,
  });

let onMain;
let offMain;

before(() => {
  repo = mkdtempSync(join(tmpdir(), "tag-on-main-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  onMain = commit("first");
  commit("second");
  git("checkout", "-q", "-b", "feature", onMain);
  offMain = commit("feature only");
  git("checkout", "-q", "main");
});

after(() => rmSync(repo, { recursive: true, force: true }));

describe("check-tag-on-main", () => {
  it("passes for a commit that main contains", () => {
    const result = check(onMain);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /is on main/);
  });

  it("fails for a commit only on another branch", () => {
    const result = check(offMain);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not on main/);
  });

  it("fails when the commit or the branch can't be resolved", () => {
    assert.equal(check("0".repeat(40)).status, 1);
    assert.equal(check(onMain, "no-such-branch").status, 1);
  });
});
