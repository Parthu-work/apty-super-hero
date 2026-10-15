#!/usr/bin/env node
/**
 * Fails unless the release commit is reachable from main, so a tag pushed
 * on a side branch can never publish. Usage:
 *   node tooling/scripts/check-tag-on-main.mjs <commit> [<main ref>]
 */
import { spawnSync } from "node:child_process";

const [commit = "", mainRef = "origin/main"] = process.argv.slice(2);

const git = (...args) => spawnSync("git", args, { encoding: "utf8" });

const resolved = git("rev-parse", "--verify", "--quiet", `${commit}^{commit}`);
if (resolved.status !== 0) {
  console.error(`✗ ${commit || "(no commit given)"} is not a commit`);
  process.exit(1);
}
if (git("rev-parse", "--verify", "--quiet", mainRef).status !== 0) {
  console.error(`✗ ${mainRef} is not a branch here; fetch it first`);
  process.exit(1);
}
if (git("merge-base", "--is-ancestor", commit, mainRef).status !== 0) {
  console.error(`✗ ${commit} is not on ${mainRef}; release only from main`);
  process.exit(1);
}
console.log(`✓ ${commit} is on ${mainRef}`);
