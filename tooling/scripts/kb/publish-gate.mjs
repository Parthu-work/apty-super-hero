#!/usr/bin/env node
/**
 * The gate a scheduled KB pack build must pass before it is published
 * (KB-RAG K26, D5, D-DEL8): the pack is the version asked for and parses;
 * it is signed (outside a dry run); the self-check passes; the card count has
 * not dropped more than 10% from the last published pack (a manual run may
 * override this rule only, with a reason); and, where the repository holds a
 * question set for the version, the D-KB8 quality gate passes; and no card
 * names a customer from the customer-name list.
 *
 * In CI the last published pack and the customer-name list are fetched
 * from the pack host with the publish token (`KB_PUBLISH_TOKEN`) into
 * memory only: nothing downloaded is written to a file. The previous pack
 * is read with the extension's own parser before it is compared.
 *
 * It prints the job summary on stdout (the workflow appends it to
 * $GITHUB_STEP_SUMMARY): counts, ids, numbers and codes only, never a card
 * title or card text, because the job's log and summary may be public.
 *
 * Usage: node tooling/scripts/kb/publish-gate.mjs --version 5.x --pack <file>
 *   [--previous <file> | --previous-url <https url>]
 *   [--customer-names <file> | --names-url <https url>] [--questions <file>]
 *   [--override-card-drop --reason <text>] [--dry-run]
 * Exits 1 when a gate fails, 2 on a usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { customerNameHits, diffPacks, readNameList } from "./build-kb-pack.mjs";
import {
  evaluate,
  loadAgentCore,
  readPack,
  readQuestions,
  selfCheck,
} from "./eval-kb.mjs";

export const MAX_CARD_DROP = 0.1;
const FETCH_TIMEOUT_MS = 120_000;
/** The pack limit (KB_PACK_LIMITS.maxBytes) and a generous cap for a name list. */
const MAX_FETCH_BYTES = { pack: 25 * 1024 * 1024, names: 1024 * 1024 };

/**
 * A file on the pack host, read into memory with the publish token: its
 * text, or undefined for a 404 (the first run). Throws, naming only the
 * HTTP status or the limit, on anything else; never the URL or the token.
 */
export async function fetchText(
  url,
  kind,
  { token, fetchImpl = globalThis.fetch },
) {
  if (new URL(url).protocol !== "https:") {
    throw new Error(`the ${kind} URL must be https`);
  }
  if (!token) throw new Error("KB_PUBLISH_TOKEN is not set");
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`the ${kind} could not be read (HTTP ${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_FETCH_BYTES[kind]) {
    throw new Error(`the ${kind} is too large`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`the ${kind} is not UTF-8 text`);
  }
}
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
  customerNames,
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
  if (customerNames) {
    const hits = customerNameHits(pack, customerNames);
    lines.push(
      `- Customer names: ${customerNames.length} checked, ${hits.length > 0 ? `found in pages ${hits.join(", ")}` : "none found"}`,
    );
    if (hits.length > 0)
      failures.push(`customer_names (pages ${hits.join(", ")})`);
  } else {
    lines.push("- Customer names: no list given.");
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
    "--previous-url": "previousUrl",
    "--customer-names": "customerNames",
    "--names-url": "namesUrl",
    "--questions": "questions",
    "--reason": "reason",
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
  if (options.previous && options.previousUrl) {
    throw new Error("Pass --previous or --previous-url, not both.");
  }
  if (options.customerNames && options.namesUrl) {
    throw new Error("Pass --customer-names or --names-url, not both.");
  }
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
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    err(error.message);
    return 2;
  }
  const write = (lines) => {
    for (const line of [...lines, ""]) out(line);
  };
  try {
    const core = await loadAgentCore();
    const read = (path) => readFileSync(resolve(cwd, path), "utf8");
    const pack = await readPack(core, read(options.pack));
    const fetched = (url, kind) =>
      fetchText(url, kind, { token: env.KB_PUBLISH_TOKEN, fetchImpl });
    const previousText = options.previousUrl
      ? await fetched(options.previousUrl, "pack")
      : options.previous && existsSync(resolve(cwd, options.previous))
        ? read(options.previous)
        : undefined;
    let previous;
    if (previousText !== undefined) {
      try {
        previous = await readPack(core, previousText);
      } catch (error) {
        throw new Error(`the last published pack: ${error.message}`);
      }
    }
    const namesText = options.namesUrl
      ? await fetched(options.namesUrl, "names")
      : options.customerNames
        ? read(options.customerNames)
        : undefined;
    if (options.namesUrl && namesText === undefined) {
      throw new Error(
        "the customer-name list is not on the pack host (HTTP 404)",
      );
    }
    const customerNames =
      namesText === undefined ? undefined : readNameList(namesText);
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
      customerNames,
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
