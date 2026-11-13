#!/usr/bin/env node
/**
 * The gate a scheduled KB pack build must pass before it is published
 * (KB-RAG K26, D5, D-DEL8): the pack is the version asked for and parses;
 * it is signed (outside a dry run); the self-check passes; the card count has
 * not dropped more than 10% from the last published pack (a manual run may
 * override this rule only, with a reason); and, where the repository holds a
 * question set for the version, the D-KB8 quality gate passes.
 *
 * It writes the job summary: counts, ids, numbers and codes only, never a
 * card title or card text, because the job's log and summary may be public.
 *
 * Usage: node tooling/scripts/kb/publish-gate.mjs --version 5.x --pack <file>
 *   [--previous <file>] [--questions <file>]
 *   [--override-card-drop --reason <text>] [--dry-run] [--summary <file>]
 * Exits 1 when a gate fails, 2 on a usage error.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffPacks } from "./build-kb-pack.mjs";
import {
  evaluate,
  loadAgentCore,
  readPack,
  readQuestions,
  selfCheck,
} from "./eval-kb.mjs";

export const MAX_CARD_DROP = 0.1;
/** D-KB8, per version. */
export const QUALITY_GATE = {
  recallAt3: 0.9,
  notCoveredPrecision: 0.9,
  notCoveredRecall: 0.8,
  layerAccuracy: 0.7,
};
const STATUSES = ["full", "stub", "routing", "absent"];

/** The card count dropped by more than the limit from the previous pack. */
export function cardDrop(previousCount, count) {
  if (!previousCount) return { dropped: false, share: 0 };
  const share = Math.max(0, (previousCount - count) / previousCount);
  return { dropped: share > MAX_CARD_DROP, share };
}

/** Which D-KB8 numbers miss their bar; null (no such questions) misses nothing. */
export function qualityMisses(report) {
  return Object.entries(QUALITY_GATE)
    .filter(([key, min]) => report[key] !== null && report[key] < min)
    .map(([key]) => key);
}

const ids = (list) =>
  list.length > 0 ? list.map((card) => card.pageId).join(", ") : "none";

/**
 * Every gate on a parsed pack, and the summary lines. Pure: the tests give it
 * synthetic packs and reports.
 */
export function gate({
  version,
  pack,
  previous,
  selfReport,
  quality,
  overrideCardDrop = false,
  reason = "",
  dryRun = false,
}) {
  const failures = [];
  const lines = [`### KB pack ${version}`, ""];
  if (pack.aptyVersion !== version) {
    failures.push(`version_mismatch (${pack.aptyVersion})`);
  }
  if (!pack.signature && !dryRun) failures.push("unsigned");
  const counts = STATUSES.map(
    (status) =>
      `${status} ${pack.cards.filter((card) => (card.status ?? "full") === status).length}`,
  ).join(", ");
  lines.push(`- Cards: ${pack.cards.length} (${counts})`);
  if (previous) {
    const diff = diffPacks(previous, pack);
    lines.push(`- Added: ${ids(diff.added)}`);
    lines.push(`- Removed: ${ids(diff.removed)}`);
    lines.push(`- Changed: ${ids(diff.changed)}`);
    const drop = cardDrop(previous.cards.length, pack.cards.length);
    if (drop.dropped) {
      const pct = `${(drop.share * 100).toFixed(1)}%`;
      if (overrideCardDrop && reason.trim()) {
        lines.push(
          `- Card count dropped ${pct} from ${previous.cards.length}: overridden by a manual run. Reason: ${reason.replace(/\s+/g, " ").trim().slice(0, 200)}`,
        );
      } else {
        failures.push(`card_drop (${pct} from ${previous.cards.length})`);
      }
    }
  } else {
    lines.push("- No previous published pack: nothing to compare.");
  }
  lines.push(
    `- Self-check: titles rank 1 ${selfReport.titles.rank1} of ${selfReport.titles.of}, top 3 ${selfReport.titles.top3} of ${selfReport.titles.of}; symptom lines top 3 ${selfReport.symptoms.top3} of ${selfReport.symptoms.of}`,
  );
  if (selfReport.failingTitles.length > 0) {
    failures.push(
      `self_check (titles not in the top 3: ${selfReport.failingTitles.join(", ")})`,
    );
  }
  if (quality) {
    const fmt = (n) => (n === null ? "n/a" : n.toFixed(2));
    lines.push(
      `- Quality gate (${quality.questions} questions): Recall@3 ${fmt(quality.recallAt3)}, not covered precision ${fmt(quality.notCoveredPrecision)}, recall ${fmt(quality.notCoveredRecall)}, layer accuracy ${fmt(quality.layerAccuracy)}`,
    );
    const misses = qualityMisses(quality);
    if (misses.length > 0) failures.push(`quality_gate (${misses.join(", ")})`);
  } else {
    lines.push(
      "- Quality gate: no question set for this version in the repository.",
    );
  }
  lines.push(`- Pack sha256 (its checksum): ${pack.sha256}`);
  lines.push(`- Key id: ${pack.signature?.keyId ?? "unsigned"}`);
  lines.push(`- Expires: ${pack.expiresAt ?? "never"}`);
  lines.push(
    failures.length > 0
      ? `- **Not published.** Failed: ${failures.join("; ")}`
      : "- Gates passed.",
  );
  return { ok: failures.length === 0, failures, lines };
}

function parseArgs(argv) {
  const options = {};
  const flags = {
    "--version": "version",
    "--pack": "pack",
    "--previous": "previous",
    "--questions": "questions",
    "--reason": "reason",
    "--summary": "summary",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--override-card-drop") options.overrideCardDrop = true;
    else if (argv[i] === "--dry-run") options.dryRun = true;
    else if (flags[argv[i]] && argv[i + 1] !== undefined) {
      options[flags[argv[i]]] = argv[++i];
    } else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  if (!["4.x", "5.x", "common"].includes(options.version)) {
    throw new Error("--version takes 4.x, 5.x or common.");
  }
  if (!options.pack) throw new Error("--pack is required.");
  if (options.overrideCardDrop && !options.reason?.trim()) {
    throw new Error("--override-card-drop needs --reason.");
  }
  return options;
}

export async function run({
  argv,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
  summary = process.env.GITHUB_STEP_SUMMARY,
}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(error.message);
    return 2;
  }
  const write = (lines) => {
    for (const line of lines) out(line);
    const target = options.summary ?? summary;
    if (target) appendFileSync(target, `${lines.join("\n")}\n\n`);
  };
  try {
    const core = await loadAgentCore();
    const read = (path) => readFileSync(resolve(cwd, path), "utf8");
    const pack = await readPack(core, read(options.pack));
    const previous =
      options.previous && existsSync(resolve(cwd, options.previous))
        ? JSON.parse(read(options.previous))
        : undefined;
    const quality =
      options.questions && existsSync(resolve(cwd, options.questions))
        ? evaluate(core, pack, readQuestions(read(options.questions)))
        : undefined;
    const result = gate({
      version: options.version,
      pack,
      previous,
      selfReport: selfCheck(core, pack),
      quality,
      overrideCardDrop: options.overrideCardDrop,
      reason: options.reason,
      dryRun: options.dryRun,
    });
    write(result.lines);
    return result.ok ? 0 : 1;
  } catch (error) {
    // The message names a code or a file, never card text.
    write([
      `### KB pack ${options.version}`,
      "",
      `- **Not published.** The pack could not be checked: ${error instanceof SyntaxError ? "not valid JSON" : error.message}`,
    ]);
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
