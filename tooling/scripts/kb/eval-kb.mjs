#!/usr/bin/env node
/**
 * Evaluates KB retrieval on a set of questions (docs/tasks/kb-rag/MASTER.md,
 * K8): Recall@1, Recall@3, MRR, "not covered" precision and recall, and the
 * questions it misses, by id only. It runs the same search the extension
 * runs (`createKbIndex` from @apty/agent-core's build output, which
 * `npm run typecheck` or `npm run build` writes). `--calibrate` suggests the
 * threshold to store in the pack (`build-kb-pack --threshold`).
 *
 * The real 40-question set is internal: the KB owner keeps it and the pack
 * outside this repository and runs this locally. A synthetic set runs in CI.
 *
 * Usage: pnpm kb:eval --pack <file> --questions <file> [--threshold <n>]
 *   [--calibrate] [--json]
 *
 * A questions file is `[{ "id"?, "q", "expectedPageIds": [], "expectedLayer"? }]`;
 * an empty `expectedPageIds` means the KB should not cover the question.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_CORE = new URL(
  "../../../packages/agent-core/dist/src/index.js",
  import.meta.url,
);
const RANK_DEPTH = 10;

export async function loadAgentCore() {
  try {
    return await import(AGENT_CORE.href);
  } catch (error) {
    throw new Error(
      `Build @apty/agent-core first (npm run typecheck or npm run build): ${error?.code ?? error?.name}`,
    );
  }
}

const sha256 = async (text) => createHash("sha256").update(text).digest("hex");

/** The pack, checked as the extension checks it. */
export async function readPack(core, text) {
  const parsed = await core.parseKbPack(text, { sha256 });
  if (!parsed.ok) throw new Error(`The pack was refused: ${parsed.code}`);
  return parsed.pack;
}

export function readQuestions(text) {
  const list = JSON.parse(text);
  if (!Array.isArray(list))
    throw new Error("The questions file is not a list.");
  return list.map((item, i) => {
    if (typeof item?.q !== "string" || !Array.isArray(item.expectedPageIds)) {
      throw new Error(`Question ${i + 1} needs "q" and "expectedPageIds".`);
    }
    return {
      id: String(item.id ?? i + 1),
      q: item.q,
      expectedPageIds: item.expectedPageIds.map(String),
      expectedLayer: item.expectedLayer,
    };
  });
}

function withThreshold(pack, threshold) {
  if (threshold === undefined) return pack;
  const retrieval = { ...pack.retrieval };
  if (threshold === null) delete retrieval.threshold;
  else retrieval.threshold = threshold;
  return { ...pack, retrieval };
}

const round = (n) => Math.round(n * 1000) / 1000;
const ratio = (part, whole) => (whole === 0 ? null : round(part / whole));

/**
 * The metrics for `questions` against `pack`, with the pack's threshold or
 * `threshold` in its place (null: none). Same pack and questions, same numbers.
 */
export function evaluate(core, pack, questions, { threshold } = {}) {
  const index = core.createKbIndex(withThreshold(pack, threshold));
  const covered = questions.filter((q) => q.expectedPageIds.length > 0);
  let hit1 = 0;
  let hit3 = 0;
  let reciprocal = 0;
  let layerTotal = 0;
  let layerHits = 0;
  let predictedNotCovered = 0;
  let correctNotCovered = 0;
  const misses = [];
  for (const question of questions) {
    const result = index.search(question.q, {
      topK: RANK_DEPTH,
      onePerCard: true,
    });
    const ranked = result.hits.map((hit) => hit.chunk.pageId);
    const expected = new Set(question.expectedPageIds);
    const notCovered = result.status === "not_covered";
    if (notCovered) predictedNotCovered++;
    if (expected.size === 0) {
      if (notCovered) correctNotCovered++;
      else
        misses.push({ id: question.id, expected: [], got: ranked.slice(0, 3) });
      continue;
    }
    const rank = ranked.findIndex((pageId) => expected.has(pageId));
    if (rank === 0) hit1++;
    if (rank >= 0 && rank < 3) hit3++;
    if (rank >= 0) reciprocal += 1 / (rank + 1);
    if (question.expectedLayer !== undefined && rank >= 0) {
      layerTotal++;
      if (result.hits[rank]?.chunk.layer === question.expectedLayer)
        layerHits++;
    }
    if (rank !== 0) {
      misses.push({
        id: question.id,
        expected: [...expected].sort(),
        got: ranked.slice(0, 3),
      });
    }
  }
  const trueNotCovered = questions.length - covered.length;
  return {
    questions: questions.length,
    covered: covered.length,
    threshold: index.info.calibrated
      ? withThreshold(pack, threshold).retrieval.threshold
      : null,
    mode: index.info.mode,
    recallAt1: ratio(hit1, covered.length),
    recallAt3: ratio(hit3, covered.length),
    mrr: ratio(reciprocal, covered.length),
    layerAccuracy: ratio(layerHits, layerTotal),
    notCoveredPrecision: ratio(correctNotCovered, predictedNotCovered),
    notCoveredRecall: ratio(correctNotCovered, trueNotCovered),
    misses,
  };
}

/**
 * The threshold that sorts the most questions correctly into covered (top
 * score at or above it) and not covered, the lowest such one on a tie; the
 * candidates are 0 and the midpoints between the top scores seen.
 */
export function calibrate(core, pack, questions) {
  const index = core.createKbIndex(withThreshold(pack, null));
  const tops = questions.map((question) => ({
    covered: question.expectedPageIds.length > 0,
    top: index.search(question.q, { topK: 1 }).hits[0]?.score ?? 0,
  }));
  const scores = [...new Set(tops.map((t) => t.top))].sort((a, b) => a - b);
  const candidates = [0];
  for (let i = 1; i < scores.length; i++) {
    candidates.push((scores[i - 1] + scores[i]) / 2);
  }
  let best = { threshold: 0, correct: -1 };
  for (const threshold of candidates) {
    const correct = tops.filter(
      (t) => (t.top > 0 && t.top >= threshold) === t.covered,
    ).length;
    if (correct > best.correct) best = { threshold, correct };
  }
  return {
    threshold: round(best.threshold),
    correctlySorted: best.correct,
    questions: questions.length,
  };
}

function format(report) {
  const pct = (n) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);
  const lines = [
    `${report.questions} questions (${report.covered} the KB should cover), ${report.mode}, threshold ${report.threshold ?? "none"}`,
    `Recall@1 ${pct(report.recallAt1)}  Recall@3 ${pct(report.recallAt3)}  MRR ${report.mrr ?? "n/a"}  layer ${pct(report.layerAccuracy)}`,
    `"not covered" precision ${pct(report.notCoveredPrecision)}  recall ${pct(report.notCoveredRecall)}`,
  ];
  for (const miss of report.misses) {
    lines.push(
      `  miss ${miss.id}: expected ${miss.expected.join(",") || "not covered"}, got ${miss.got.join(",") || "not covered"}`,
    );
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { calibrate: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--calibrate") options.calibrate = true;
    else if (flag === "--json") options.json = true;
    else if (flag === "--pack" || flag === "--questions") {
      options[flag.slice(2)] = argv[++i];
    } else if (flag === "--threshold") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("--threshold takes a score of 0 or more.");
      }
      options.threshold = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!options.pack || !options.questions) {
    throw new Error("Pass --pack <file> and --questions <file>.");
  }
  return options;
}

/** The CLI; prints metrics and question ids only, never question or card text. */
export async function run({
  argv,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  try {
    const options = parseArgs(argv);
    const core = await loadAgentCore();
    const pack = await readPack(
      core,
      readFileSync(resolve(cwd, options.pack), "utf8"),
    );
    const questions = readQuestions(
      readFileSync(resolve(cwd, options.questions), "utf8"),
    );
    const report = {
      ...evaluate(core, pack, questions, { threshold: options.threshold }),
      ...(options.calibrate
        ? { suggestedThreshold: calibrate(core, pack, questions) }
        : {}),
    };
    if (options.json) {
      out(JSON.stringify(report, null, 2));
    } else {
      out(format(report));
      if (report.suggestedThreshold) {
        const s = report.suggestedThreshold;
        out(
          `Suggested threshold ${s.threshold}: sorts ${s.correctlySorted} of ${s.questions} into covered and not covered. Build with --threshold ${s.threshold}.`,
        );
      }
    }
    return 0;
  } catch (error) {
    err(
      error instanceof SyntaxError
        ? "A file is not valid JSON."
        : error.message,
    );
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
