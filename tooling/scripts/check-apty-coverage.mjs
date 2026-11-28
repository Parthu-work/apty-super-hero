#!/usr/bin/env node
/**
 * Keeps the Agent's mirrored player rules honest (SE flow WP1): every
 * condition in docs/development/coverage-manifest.json cites the Apty code
 * it mirrors as line ranges, each with a hash of those lines at the commit
 * it was verified on. Run against read-only checkouts of apty-dap (5.x)
 * and apty-assist (4.x) at a newer commit, a changed or missing range
 * fails and names the conditions and rule IDs to re-verify. Files under
 * the player's visibility directories that no range cites are listed as
 * unmapped.
 *
 * The manifest's shape (and, with --phase, that every condition the phase
 * lists has an entry) is always checked. Cited lines are compared only when
 * both reference checkouts are found (git work trees); otherwise the
 * command prints "skipped: reference checkouts not found" and passes, so
 * preflight and CI never depend on them.
 *
 * Ranges are read with `git show <ref>:<path>`, so the checkouts are never
 * changed. The ref is each checkout's HEAD, or the manifest's pinned commit
 * with --pinned. A range verified on a commit the ref does not contain yet
 * is skipped at that ref; a range marked `"track": false` (code an older
 * player runs, cited for the record) is never compared.
 *
 * Usage:
 *   node tooling/scripts/check-apty-coverage.mjs [--dap <dir>] [--assist <dir>]
 *       [--manifest <file>] [--phase <n>] [--pinned] [--rehash]
 * Checkouts default to $APTY_DAP_DIR / $APTY_ASSIST_DIR, else ../apty-dap
 * and ../apty-assist next to this repository.
 * --rehash writes each range's hash from its own commit (seeding or
 * re-verifying).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_MANIFEST = join(
  ROOT,
  "docs/development/coverage-manifest.json",
);
export const REPOS = ["apty-dap", "apty-assist"];
const VERSIONS = new Set(["4.x", "5.x"]);
const STATUSES = new Set(["verified", "corrected", "inferred", "not_found"]);
const SHA256 = /^[0-9a-f]{64}$/;

/** The SHA-256 of lines `from`..`to` (1-based, inclusive) of `text`, line endings normalised. */
export function hashLines(text, from, to) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (from < 1 || to < from || to > lines.length) return undefined;
  return createHash("sha256")
    .update(lines.slice(from - 1, to).join("\n"))
    .digest("hex");
}

/** Problems with the manifest's shape, one string each; empty when it is well formed. */
export function shapeProblems(manifest) {
  const problems = [];
  if (!manifest || !Array.isArray(manifest.conditions)) {
    return ["the manifest has no conditions list"];
  }
  const seen = new Set();
  manifest.conditions.forEach((c, i) => {
    const at = `conditions[${i}]${c?.id ? ` (${c.id})` : ""}`;
    if (typeof c?.id !== "string" || !c.id) problems.push(`${at}: no id`);
    for (const name of [c?.id, ...(c?.aliases ?? [])]) {
      if (typeof name !== "string") continue;
      if (seen.has(name)) problems.push(`${at}: ${name} is listed twice`);
      seen.add(name);
    }
    if (!VERSIONS.has(c?.version)) problems.push(`${at}: version`);
    if (!STATUSES.has(c?.status)) problems.push(`${at}: status`);
    if (typeof c?.condition !== "string" || !c.condition) {
      problems.push(`${at}: no condition text`);
    }
    if (!Array.isArray(c?.ruleIds)) problems.push(`${at}: ruleIds`);
    if (!Array.isArray(c?.ranges)) {
      problems.push(`${at}: ranges`);
      return;
    }
    if (c.status !== "not_found" && c.ranges.length === 0) {
      problems.push(`${at}: no range cited`);
    }
    c.ranges.forEach((r, j) => {
      const where = `${at} range ${j}`;
      if (!REPOS.includes(r?.repo)) problems.push(`${where}: repo`);
      if (typeof r?.commit !== "string" || !r.commit) {
        problems.push(`${where}: commit`);
      }
      if (typeof r?.path !== "string" || !r.path || r.path.startsWith("/")) {
        problems.push(`${where}: path`);
      }
      if (!Number.isInteger(r?.from) || !Number.isInteger(r?.to)) {
        problems.push(`${where}: lines`);
      } else if (r.from < 1 || r.to < r.from) {
        problems.push(`${where}: lines ${r.from}-${r.to}`);
      }
      if (r?.sha256 !== undefined && !SHA256.test(r.sha256)) {
        problems.push(`${where}: sha256`);
      }
      if (r?.track !== undefined && typeof r.track !== "boolean") {
        problems.push(`${where}: track`);
      }
    });
  });
  return problems;
}

/** Conditions a phase lists that have no manifest entry (by id or alias). */
export function missingForPhase(manifest, phase) {
  const listed = manifest.phases?.[String(phase)];
  if (!Array.isArray(listed)) return [`phase ${phase} lists no conditions`];
  const known = new Set(
    manifest.conditions.flatMap((c) => [c.id, ...(c.aliases ?? [])]),
  );
  return listed.filter((id) => !known.has(id));
}

/**
 * Each tracked range checked at `refs[repo]` in its checkout: `changed`
 * when the lines hash differently, `missing` when the file or the lines are
 * gone, `newer` when the range was verified on a commit the ref does not
 * contain, `unhashed` when the manifest holds no hash for it yet.
 */
export function checkRanges(manifest, dirs, refs, io) {
  const findings = [];
  const files = new Map();
  for (const c of manifest.conditions) {
    c.ranges.forEach((r, index) => {
      const dir = dirs[r.repo];
      if (!dir || r.track === false) return;
      const where = { id: c.id, ruleIds: c.ruleIds, range: r, index };
      if (!r.sha256) {
        findings.push({ ...where, kind: "unhashed" });
        return;
      }
      const ref = refs[r.repo] ?? "HEAD";
      if (!io.contains(dir, ref, r.commit)) {
        findings.push({ ...where, kind: "newer", detail: `not in ${ref}` });
        return;
      }
      const key = `${r.repo}\0${r.path}`;
      if (!files.has(key)) files.set(key, io.show(dir, ref, r.path));
      const text = files.get(key);
      const now =
        text === undefined ? undefined : hashLines(text, r.from, r.to);
      if (now === undefined) {
        findings.push({
          ...where,
          kind: "missing",
          detail:
            text === undefined ? `file not in ${ref}` : "lines past the end",
        });
      } else if (now !== r.sha256) {
        findings.push({ ...where, kind: "changed", detail: `at ${ref}` });
      }
    });
  }
  return findings;
}

/** Files under the manifest's `unmappedRoots` in a checkout that no range cites. */
export function unmappedFiles(manifest, repo, files) {
  const roots = manifest.unmappedRoots?.[repo] ?? [];
  const cited = new Set(
    manifest.conditions.flatMap((c) =>
      c.ranges.filter((r) => r.repo === repo).map((r) => r.path),
    ),
  );
  return files.filter(
    (file) =>
      roots.some((root) => file.startsWith(`${root.replace(/\/+$/, "")}/`)) &&
      /\.(ts|tsx)$/.test(file) &&
      !/\.(test|spec)\.tsx?$/.test(file) &&
      !cited.has(file),
  );
}

const git = (dir, args) =>
  execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

/** Reads a checkout through git only, so it is never changed. */
export const GIT_IO = {
  show(dir, ref, path) {
    try {
      return git(dir, ["show", `${ref}:${path}`]);
    } catch {
      return undefined;
    }
  },
  contains(dir, ref, commit) {
    const base = commit.replace(/\^+$/, "");
    try {
      git(dir, ["merge-base", "--is-ancestor", base, ref]);
      return true;
    } catch {
      return false;
    }
  },
  files(dir, ref) {
    return git(dir, ["ls-tree", "-r", "--name-only", ref])
      .split("\n")
      .filter(Boolean);
  },
};

/** Writes each range's hash from the file at the range's own commit. */
export function rehash(manifest, dirs, io = GIT_IO) {
  const problems = [];
  const files = new Map();
  for (const c of manifest.conditions) {
    for (const r of c.ranges) {
      const dir = dirs[r.repo];
      if (!dir) {
        problems.push(`${c.id}: no checkout of ${r.repo}`);
        continue;
      }
      const key = `${r.repo}\0${r.commit}\0${r.path}`;
      if (!files.has(key)) {
        files.set(key, io.show(dir, r.commit, r.path));
      }
      const text = files.get(key);
      const sha =
        text === undefined ? undefined : hashLines(text, r.from, r.to);
      if (sha === undefined) {
        problems.push(
          `${c.id}: ${r.repo}:${r.path}:${r.from}-${r.to}@${r.commit} cannot be read`,
        );
        delete r.sha256;
      } else {
        r.sha256 = sha;
      }
    }
  }
  return problems;
}

function parseArgs(argv) {
  const options = { rehash: false, pinned: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rehash") options.rehash = true;
    else if (arg === "--pinned") options.pinned = true;
    else if (["--dap", "--assist", "--manifest", "--phase"].includes(arg)) {
      options[arg.slice(2)] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function checkoutDirs(options) {
  const pick = (given, env, sibling) => {
    const dir = given || process.env[env] || join(ROOT, "..", sibling);
    if (!existsSync(dir)) return undefined;
    try {
      git(dir, ["rev-parse", "--git-dir"]);
      return dir;
    } catch {
      return undefined;
    }
  };
  return {
    "apty-dap": pick(options.dap, "APTY_DAP_DIR", "apty-dap"),
    "apty-assist": pick(options.assist, "APTY_ASSIST_DIR", "apty-assist"),
  };
}

const rangeText = (r) => `${r.repo}:${r.path}:${r.from}-${r.to}@${r.commit}`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  const file = options.manifest ?? DEFAULT_MANIFEST;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const shape = shapeProblems(manifest);
  if (shape.length > 0) {
    console.error("✗ The coverage manifest is malformed:");
    for (const problem of shape) console.error(`  ${problem}`);
    process.exit(1);
  }
  if (options.phase !== undefined) {
    const missing = missingForPhase(manifest, options.phase);
    if (missing.length > 0) {
      console.error(
        `✗ Phase ${options.phase} conditions with no manifest entry: ${missing.join(", ")}`,
      );
      process.exit(1);
    }
  }
  const dirs = checkoutDirs(options);
  if (options.rehash) {
    const problems = rehash(manifest, dirs);
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.log(
      `${problems.length === 0 ? "✓" : "✗"} Rehashed ${manifest.conditions.length} conditions`,
    );
    process.exit(problems.length === 0 ? 0 : 1);
  }
  if (!dirs["apty-dap"] || !dirs["apty-assist"]) {
    const absent = REPOS.filter((repo) => !dirs[repo]).join(", ");
    console.log(
      `✓ ${manifest.conditions.length} conditions well formed; line check skipped: reference checkouts not found (${absent})`,
    );
    return;
  }
  const refs = Object.fromEntries(
    REPOS.map((repo) => [
      repo,
      options.pinned ? (manifest.repos?.[repo]?.pinned ?? "HEAD") : "HEAD",
    ]),
  );
  const findings = checkRanges(manifest, dirs, refs, GIT_IO);
  for (const repo of REPOS) {
    let files = [];
    try {
      files = GIT_IO.files(dirs[repo], refs[repo]);
    } catch {
      continue;
    }
    for (const unmapped of unmappedFiles(manifest, repo, files)) {
      console.log(`  unmapped: ${repo}:${unmapped}`);
    }
  }
  const INFO = new Set(["unhashed", "newer"]);
  const failing = findings.filter((f) => !INFO.has(f.kind));
  for (const f of findings) {
    const rules =
      f.ruleIds.length > 0 ? ` (rules ${f.ruleIds.join(", ")})` : "";
    const line = `  ${f.kind}: ${f.id}${rules} ${rangeText(f.range)}${f.detail ? `: ${f.detail}` : ""}`;
    (INFO.has(f.kind) ? console.log : console.error)(line);
  }
  if (failing.length > 0) {
    const ids = [...new Set(failing.map((f) => f.id))];
    console.error(
      `✗ ${failing.length} cited range(s) changed or missing at ${refs["apty-dap"]} / ${refs["apty-assist"]}; re-verify ${ids.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(
    `✓ ${manifest.conditions.length} conditions; every hashed range matches the checkouts`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
