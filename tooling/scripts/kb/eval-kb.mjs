#!/usr/bin/env node
/**
 * Evaluates KB retrieval on a set of questions (docs/tasks/kb-rag/MASTER.md,
 * K8): Recall@1, Recall@3, MRR, "not covered" precision and recall, and the
 * questions it misses, by id only. It runs the same search the extension
 * runs (`createKbIndex` from @apty/agent-core's build output, which
 * `npm run typecheck` or `npm run build` writes). `--calibrate` suggests the
 * coverage settings to build a schema 2 pack with (`kb:pack --coverage-min
 * --coverage-min-idf`), or for a schema 1 pack the score threshold.
 *
 * The real 40-question set is internal: the KB owner keeps it and the pack
 * outside this repository and runs this locally. A synthetic set runs in CI.
 *
 * Usage: pnpm kb:eval --pack <file> --questions <file> [--calibrate]
 *   [--coverage-min <x>] [--coverage-min-idf <y>] [--threshold <n>]
 *   [--by-category] [--json]
 *
 * A questions file is `[{ "id"?, "q", "expectedPageIds": [], "expectedLayer"?, "category"?, "surface"? }]`;
 * a "multi" question needs all its cards in the top 3, and one with
 * `"surface": "responder"` (a bare how-to, a question in another script) is
 * left to the responder's own tests, not scored here;
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
      ...(typeof item.category === "string" ? { category: item.category } : {}),
      ...(item.surface === "responder" ? { surface: "responder" } : {}),
    };
  });
}

function withCoverage(pack, coverage) {
  if (coverage === undefined) return pack;
  return { ...pack, retrieval: { ...pack.retrieval, coverage } };
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
export function evaluate(core, pack, all, { threshold, coverage } = {}) {
  const questions = all.filter((q) => q.surface !== "responder");
  const tuned = withCoverage(withThreshold(pack, threshold), coverage);
  const index = core.createKbIndex(tuned);
  const covered = questions.filter((q) => q.expectedPageIds.length > 0);
  let hit1 = 0;
  let hit3 = 0;
  let reciprocal = 0;
  let layerTotal = 0;
  let layerHits = 0;
  let predictedNotCovered = 0;
  let correctNotCovered = 0;
  let coveredAnswered = 0;
  const misses = [];
  for (const question of questions) {
    const result = index.search(question.q, {
      topK: RANK_DEPTH,
      onePerCard: true,
    });
    const ranked =
      result.status === "stub" && result.card
        ? [result.card.pageId]
        : result.hits.map((hit) => hit.chunk.pageId);
    const expected = new Set(question.expectedPageIds);
    const notCovered = result.status === "not_covered";
    if (notCovered) predictedNotCovered++;
    if (expected.size === 0) {
      if (notCovered) correctNotCovered++;
      else
        misses.push({ id: question.id, expected: [], got: ranked.slice(0, 3) });
      continue;
    }
    if (!notCovered) coveredAnswered++;
    // A question naming two symptoms ("multi") needs every card: its rank is the last one's.
    const ranks = [...expected].map((pageId) => ranked.indexOf(pageId));
    const rank =
      question.category === "multi"
        ? ranks.includes(-1)
          ? -1
          : Math.max(...ranks)
        : ranked.findIndex((pageId) => expected.has(pageId));
    if (rank === 0) hit1++;
    if (rank >= 0 && rank < 3) hit3++;
    if (rank >= 0) reciprocal += 1 / (rank + 1);
    if (question.expectedLayer !== undefined && rank >= 0) {
      layerTotal++;
      if (result.hits[rank]?.chunk.layer === question.expectedLayer)
        layerHits++;
    }
    const missed =
      question.category === "multi" ? rank < 0 || rank > 2 : rank !== 0;
    if (missed) {
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
    schemaVersion: pack.schemaVersion,
    threshold:
      pack.schemaVersion === 1 && index.info.calibrated
        ? tuned.retrieval.threshold
        : null,
    coverage:
      pack.schemaVersion === 2 ? (tuned.retrieval.coverage ?? null) : null,
    mode: index.info.mode,
    recallAt1: ratio(hit1, covered.length),
    recallAt3: ratio(hit3, covered.length),
    mrr: ratio(reciprocal, covered.length),
    layerAccuracy: ratio(layerHits, layerTotal),
    notCoveredPrecision: ratio(correctNotCovered, predictedNotCovered),
    notCoveredRecall: ratio(correctNotCovered, trueNotCovered),
    coveredRecall: ratio(coveredAnswered, covered.length),
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

/** The metrics per question category (`category`, or "none"), in name order. */
export function byCategory(core, pack, questions, options = {}) {
  const groups = new Map();
  for (const question of questions) {
    const name = question.category ?? "none";
    groups.set(name, [...(groups.get(name) ?? []), question]);
  }
  return [...groups.keys()].sort().map((name) => {
    const report = evaluate(core, pack, groups.get(name), options);
    return {
      category: name,
      questions: report.questions,
      recallAt1: report.recallAt1,
      recallAt3: report.recallAt3,
      layerAccuracy: report.layerAccuracy,
      notCoveredPrecision: report.notCoveredPrecision,
      notCoveredRecall: report.notCoveredRecall,
      misses: report.misses.map((miss) => miss.id),
    };
  });
}

const UNCAPPED = { min: 0, minIdf: 0, minTerms: 0 };

/** The idf at each 10th percentile from the 10th to the 90th, nearest rank, rounded as printed. */
export function idfPercentiles(index) {
  const idf = index.vocabularyIdf();
  if (idf.length === 0) return [0];
  return [10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) =>
    round(idf[Math.min(idf.length - 1, Math.ceil((p / 100) * idf.length) - 1)]),
  );
}

/**
 * The coverage settings for a schema 2 pack: the grid of `min` 0.05 to
 * 0.95 (step 0.05) and `minIdf` at the vocabulary's idf percentiles, best
 * by Youden's J (covered recall + not-covered recall - 1), among the
 * settings that lose at most 0.02 of Recall@3 against the uncapped
 * ranking. Ties go to the higher Recall@3, then the lower `min` and
 * `minIdf`. `minTerms` stays at the pack's (default 1).
 */
export function calibrateCoverage(core, pack, questions) {
  const minTerms = pack.retrieval.coverage?.minTerms ?? 1;
  const baseline = evaluate(core, pack, questions, { coverage: UNCAPPED });
  const floor = (baseline.recallAt3 ?? 0) - 0.02;
  const percentiles = [...new Set(idfPercentiles(core.createKbIndex(pack)))];
  let best;
  for (let step = 1; step <= 19; step++) {
    const min = round(step * 0.05);
    for (const minIdf of percentiles) {
      const report = evaluate(core, pack, questions, {
        coverage: { min, minIdf, minTerms },
      });
      if ((report.recallAt3 ?? 0) < floor - 1e-9) continue;
      const j = round(
        (report.coveredRecall ?? 0) + (report.notCoveredRecall ?? 0) - 1,
      );
      const better =
        !best ||
        j > best.j ||
        (j === best.j && (report.recallAt3 ?? 0) > best.recallAt3);
      if (better) {
        best = {
          min,
          minIdf,
          minTerms,
          j,
          recallAt3: report.recallAt3 ?? 0,
          notCoveredPrecision: report.notCoveredPrecision,
          notCoveredRecall: report.notCoveredRecall,
        };
      }
    }
  }
  return { ...best, uncappedRecallAt3: baseline.recallAt3 };
}

function format(report) {
  const pct = (n) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);
  const lines = [
    `${report.questions} questions (${report.covered} the KB should cover), ${report.mode}, ${
      report.schemaVersion === 2
        ? `coverage ${report.coverage ? `min ${report.coverage.min}, minIdf ${report.coverage.minIdf}, minTerms ${report.coverage.minTerms}` : "defaults"}`
        : `threshold ${report.threshold ?? "none"}`
    }`,
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
  const options = { calibrate: false, json: false, byCategory: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--calibrate") options.calibrate = true;
    else if (flag === "--json") options.json = true;
    else if (flag === "--by-category") options.byCategory = true;
    else if (flag === "--pack" || flag === "--questions") {
      options[flag.slice(2)] = argv[++i];
    } else if (flag === "--coverage-min" || flag === "--coverage-min-idf") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${flag} takes a number of 0 or more.`);
      }
      options[flag === "--coverage-min" ? "coverageMin" : "coverageMinIdf"] =
        value;
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
    const coverage =
      options.coverageMin !== undefined || options.coverageMinIdf !== undefined
        ? {
            ...core.KB_COVERAGE_DEFAULTS,
            ...pack.retrieval.coverage,
            ...(options.coverageMin !== undefined
              ? { min: options.coverageMin }
              : {}),
            ...(options.coverageMinIdf !== undefined
              ? { minIdf: options.coverageMinIdf }
              : {}),
          }
        : undefined;
    const v2 = pack.schemaVersion === 2;
    const report = {
      ...evaluate(core, pack, questions, {
        threshold: options.threshold,
        coverage,
      }),
      ...(options.byCategory
        ? {
            byCategory: byCategory(core, pack, questions, {
              threshold: options.threshold,
              coverage,
            }),
          }
        : {}),
      ...(options.calibrate && v2
        ? { suggestedCoverage: calibrateCoverage(core, pack, questions) }
        : {}),
      ...(options.calibrate && !v2
        ? { suggestedThreshold: calibrate(core, pack, questions) }
        : {}),
    };
    if (options.json) {
      out(JSON.stringify(report, null, 2));
    } else {
      out(format(report));
      const pct = (n) => (n === null ? "n/a" : `${(n * 100).toFixed(0)}%`);
      for (const c of report.byCategory ?? []) {
        out(
          `  ${c.category}: ${c.questions} q, R@1 ${pct(c.recallAt1)}, R@3 ${pct(c.recallAt3)}, layer ${pct(c.layerAccuracy)}, not covered P ${pct(c.notCoveredPrecision)} R ${pct(c.notCoveredRecall)}${c.misses.length ? `, misses ${c.misses.join(",")}` : ""}`,
        );
      }
      if (report.suggestedCoverage) {
        const c = report.suggestedCoverage;
        out(
          `Suggested coverage: min ${c.min}, minIdf ${c.minIdf} (Youden J ${c.j}, Recall@3 ${c.recallAt3} against ${c.uncappedRecallAt3} uncapped). Build with --coverage-min ${c.min} --coverage-min-idf ${c.minIdf}.`,
        );
      }
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
