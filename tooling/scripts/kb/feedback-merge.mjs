#!/usr/bin/env node
/**
 * Merges the SEs' feedback exports for the KB owner (KB-RAG K28, A4). It
 * reads every tracking sheet (Options → Feedback → Export CSV,
 * `apty-kb-feedback-<day>.csv`) and every questions file (Export questions,
 * `apty-kb-questions-<day>.json`) in a folder and its subfolders, removes
 * duplicates, and writes one tracking sheet and one kb:eval question set per
 * Apty version, with stable ids, plus `summary.json`.
 *
 * - A tracking row is a duplicate of another with the same case, card shown
 *   and mark (the latest date is kept); a row with no case, of an identical
 *   row.
 * - A question is a duplicate of another with the same text, ignoring case
 *   and spacing (the first, in file name order, is kept). Its version is the
 *   one the tracking rows give its card; otherwise it goes under "unknown".
 * - Only text the SE exported is copied: no question is written that was
 *   not in a questions file.
 * - The output folder must be outside this repository, since the files hold
 *   the SEs' questions and notes.
 *
 * It prints counts only, never a question or a note.
 *
 * Usage: pnpm kb:feedback-merge --in <folder> --out <folder>
 * Exits 1 when a file cannot be read, 2 on a usage error.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrowserRuntime } from "./eval-kb.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const VERSIONS = new Set(["4.x", "5.x"]);

/** The extension's own tracking-sheet columns, from @apty/browser-runtime's build. */
export async function trackingColumns() {
  const { feedbackCsv } = await loadBrowserRuntime("case/feedback-store.js");
  return feedbackCsv([]).trim().split(",");
}

/** RFC 4180 CSV: the header and each row as an object keyed by it. */
export function parseCsv(text) {
  const records = [];
  let record = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else cell += char;
  }
  if (cell || record.length > 0) records.push([...record, cell]);
  const [header = [], ...rows] = records.filter(
    (row) => row.length > 1 || row[0],
  );
  return {
    header,
    rows: rows.map((row) =>
      Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""])),
    ),
  };
}

function csvCell(value) {
  const text = value ?? "";
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const hash = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 10);
const versionOf = (value) => (VERSIONS.has(value) ? value : "unknown");
const cardId = (value) => (value ?? "").split("#")[0];
const normalized = (question) =>
  question.toLowerCase().replace(/\s+/g, " ").trim();

function rowKey(row, columns) {
  return row["case id"]
    ? ["case", row["case id"], row["card shown"], row["mark"]].join("\u0000")
    : ["row", ...columns.map((column) => row[column])].join("\u0000");
}

const count = (list, of) =>
  list.reduce((counts, item) => {
    const key = of(item);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

function bucket(versions, version) {
  versions[version] ??= {
    rows: new Map(),
    questions: new Map(),
    inputRows: 0,
    inputQuestions: 0,
  };
  return versions[version];
}

/**
 * The merge itself, on parsed exports in file name order: `tracking` is
 * `[{ source, rows }]`, `questions` is `[{ source, items }]`.
 */
export function mergeFeedback({ tracking, questions, columns = [] }) {
  const versions = {};
  const cardVersions = new Map();
  for (const { rows } of tracking) {
    for (const row of rows) {
      const version = versionOf(row["Apty version"]);
      const target = bucket(versions, version);
      target.inputRows++;
      const key = rowKey(row, columns);
      const kept = target.rows.get(key);
      if (!kept || row["date"] >= kept["date"]) {
        target.rows.set(key, { id: `fb-${hash(key)}`, ...row });
      }
      if (version === "unknown") continue;
      for (const card of [row["right card"], cardId(row["card shown"])]) {
        if (!card) continue;
        cardVersions.set(
          card,
          new Set([...(cardVersions.get(card) ?? []), version]),
        );
      }
    }
  }
  for (const { items } of questions) {
    for (const item of items) {
      const known = new Set(
        item.expectedPageIds.flatMap((id) => [
          ...(cardVersions.get(String(id)) ?? []),
        ]),
      );
      const version = known.size === 1 ? [...known][0] : "unknown";
      const target = bucket(versions, version);
      target.inputQuestions++;
      const key = normalized(item.q);
      if (target.questions.has(key)) continue;
      target.questions.set(key, {
        id: `field-${hash(key)}`,
        category: "field",
        q: item.q,
        expectedPageIds: item.expectedPageIds.map(String),
      });
    }
  }
  return {
    versions: Object.fromEntries(
      Object.keys(versions)
        .sort()
        .map((version) => {
          const merged = versions[version];
          const rows = [...merged.rows.values()].sort(
            (a, b) =>
              a["date"].localeCompare(b["date"]) || a.id.localeCompare(b.id),
          );
          const list = [...merged.questions.values()].sort(
            (a, b) =>
              a.expectedPageIds
                .join()
                .localeCompare(b.expectedPageIds.join()) ||
              a.id.localeCompare(b.id),
          );
          return [
            version,
            {
              rows,
              questions: list,
              duplicateRows: merged.inputRows - rows.length,
              duplicateQuestions: merged.inputQuestions - list.length,
            },
          ];
        }),
    ),
  };
}

function* files(dir) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

const isQuestionSet = (value) =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item?.q === "string" && Array.isArray(item.expectedPageIds),
  );

/** The exports in a folder, by kind, and the files that are neither. */
function readExports(input, columns) {
  const tracking = [];
  const questions = [];
  const skipped = [];
  for (const path of files(input)) {
    const source = relative(input, path).split(sep).join("/");
    const lower = path.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".json")) continue;
    const text = readFileSync(path, "utf8");
    if (lower.endsWith(".csv")) {
      const parsed = parseCsv(text);
      if (parsed.header.join(",") === columns.join(",")) {
        tracking.push({ source, rows: parsed.rows });
      } else skipped.push(source);
      continue;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${source}: not valid JSON`);
    }
    if (isQuestionSet(json)) questions.push({ source, items: json });
    else skipped.push(source);
  }
  return { tracking, questions, skipped };
}

/** Whether `path` is the repository or inside it, through any symlink. */
function insideRepository(path) {
  let existing = resolve(path);
  while (!existsSync(existing)) existing = dirname(existing);
  const real = join(realpathSync(existing), relative(existing, resolve(path)));
  const repo = realpathSync(REPO);
  const rel = relative(repo, real);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function parseArgs(argv, cwd) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--in" || argv[i] === "--out") && argv[i + 1]) {
      options[argv[i].slice(2)] = resolve(cwd, argv[++i]);
    } else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  if (!options.in || !options.out) {
    throw new Error(
      "Usage: pnpm kb:feedback-merge --in <folder> --out <folder>",
    );
  }
  if (insideRepository(options.out)) {
    throw new Error(
      "--out must be outside the repository: the merged files hold the SEs' questions and notes.",
    );
  }
  return options;
}

export async function run({
  argv,
  cwd = process.cwd(),
  out = (line) => console.log(line),
  err = (line) => console.error(line),
}) {
  let options;
  try {
    options = parseArgs(argv, cwd);
  } catch (error) {
    err(error.message);
    return 2;
  }
  try {
    const columns = await trackingColumns();
    const exports = readExports(options.in, columns);
    const merged = mergeFeedback({ ...exports, columns });
    mkdirSync(options.out, { recursive: true });
    const summary = {
      input: {
        trackingFiles: exports.tracking.length,
        questionFiles: exports.questions.length,
        skippedFiles: exports.skipped,
        rows: exports.tracking.reduce((n, file) => n + file.rows.length, 0),
        questions: exports.questions.reduce(
          (n, file) => n + file.items.length,
          0,
        ),
      },
      versions: {},
    };
    for (const [version, result] of Object.entries(merged.versions)) {
      if (result.rows.length > 0) {
        const header = ["id", ...columns];
        const lines = [
          header.join(","),
          ...result.rows.map((row) =>
            header.map((column) => csvCell(row[column])).join(","),
          ),
        ];
        writeFileSync(
          join(options.out, `tracking-${version}.csv`),
          `${lines.join("\n")}\n`,
        );
      }
      if (result.questions.length > 0) {
        writeFileSync(
          join(options.out, `questions-${version}.json`),
          `${JSON.stringify(result.questions, null, 2)}\n`,
        );
      }
      summary.versions[version] = {
        rows: result.rows.length,
        duplicateRows: result.duplicateRows,
        questions: result.questions.length,
        duplicateQuestions: result.duplicateQuestions,
        outcomes: count(result.rows, (row) => row["outcome"] || "none"),
        marks: count(result.rows, (row) => row["mark"]),
      };
    }
    writeFileSync(
      join(options.out, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    out(
      `Read ${summary.input.trackingFiles} tracking sheets (${summary.input.rows} rows) and ${summary.input.questionFiles} question files (${summary.input.questions} questions); skipped ${exports.skipped.length} other files.`,
    );
    for (const [version, s] of Object.entries(summary.versions)) {
      const outcomes = Object.entries(s.outcomes)
        .map(([name, n]) => `${name} ${n}`)
        .join(", ");
      out(
        `${version}: ${s.rows} rows (${s.duplicateRows} duplicates removed), ${s.questions} questions (${s.duplicateQuestions} duplicates removed); outcomes: ${outcomes || "none"}`,
      );
    }
    out(`Wrote ${options.out}`);
    return 0;
  } catch (error) {
    err(error.message);
    return 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
