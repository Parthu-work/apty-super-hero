/**
 * Lookup questions answered from the Apty Client's content files, with no
 * model (KB-RAG K27, E4): "is workflow X in segment Y", "show workflow X",
 * "which environment is this tab", "which workflows are hidden from the
 * widget". 4.x reads flow.json and segments.json, 5.x workflow.json,
 * segment.json and app-urls.json. Names match ignoring case and
 * punctuation ("all-users" is "All Users"); two matches ask one question;
 * no match says so and never guesses.
 */
import { flowNames } from "./content-not-visible-4x.js";
import {
  jsonOf,
  namesOf,
  playerVersionOf,
  type Rec,
  records,
  text,
  texts,
} from "./pack-kit.js";
import type { ClientEvidence } from "./types.js";

export type LookupQuestion =
  | { kind: "membership"; item: string; segment: string }
  | { kind: "show"; item: string }
  | { kind: "environment" }
  | { kind: "hidden" };

const QUOTE = `["'“”‘’]?`;
const NAME = "(.+?)";

const MEMBERSHIP = [
  // "check if General Ledger Page workflow is present in all-users segment"
  new RegExp(
    `^(?:please\\s+)?(?:check\\s+(?:if|whether)\\s+|is\\s+|whether\\s+|does\\s+)?(?:the\\s+)?${QUOTE}${NAME}${QUOTE}\\s+(?:work)?flow\\s+(?:is\\s+)?(?:present\\s+|listed\\s+|included\\s+)?in\\s+(?:the\\s+)?${QUOTE}${NAME}${QUOTE}\\s+segment\\s*\\??$`,
    "i",
  ),
  // "is workflow General Ledger Page in segment All Users"
  new RegExp(
    `^(?:please\\s+)?(?:check\\s+(?:if|whether)\\s+|is\\s+|whether\\s+|does\\s+)?(?:the\\s+)?(?:work)?flow\\s+${QUOTE}${NAME}${QUOTE}\\s+(?:is\\s+)?(?:present\\s+|listed\\s+|included\\s+)?in\\s+(?:the\\s+)?segment\\s+${QUOTE}${NAME}${QUOTE}\\s*\\??$`,
    "i",
  ),
];
const SHOW = new RegExp(
  `^(?:please\\s+)?(?:show(?:\\s+me)?|open|what\\s+is)\\s+(?:the\\s+)?(?:work)?flow\\s+${QUOTE}${NAME}${QUOTE}\\s*\\??$`,
  "i",
);
const ENVIRONMENT =
  /^(?:please\s+)?(?:which|what)\s+environment\s+(?:is|does)\s+(?:this|the)\s+(?:tab|page)\b/i;
const HIDDEN =
  /^(?:please\s+)?(?:which|what)\s+(?:work)?flows\s+are\s+hidden\s+(?:from|in)\s+(?:the\s+)?widget\s*\??$/i;

/** The lookup a message asks for, or undefined. */
export function routeLookup(input: string): LookupQuestion | undefined {
  const message = input.trim();
  for (const pattern of MEMBERSHIP) {
    const match = pattern.exec(message);
    if (match?.[1] && match[2]) {
      return {
        kind: "membership",
        item: match[1].trim(),
        segment: match[2].trim(),
      };
    }
  }
  const show = SHOW.exec(message);
  if (show?.[1]) return { kind: "show", item: show[1].trim() };
  if (ENVIRONMENT.test(message)) return { kind: "environment" };
  if (HIDDEN.test(message)) return { kind: "hidden" };
  return undefined;
}

/**
 * A name as it is compared: lower case, punctuation and spacing ignored.
 * @internal exported for tests
 */
export function normalizedName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type LookupSource = "client" | "cdn" | "capture";

/** A table column, named in the panel's language. */
export type LookupColumn =
  | "workflow"
  | "segment"
  | "listed"
  | "segmentOn"
  | "environment"
  | "id"
  | "field"
  | "value";

/** A cell the panel words itself: a yes, no or not-in-the-files, or a field name. */
export type LookupWord =
  | "@yes"
  | "@no"
  | "@unknown"
  | "@none"
  | "@notRead"
  | "@name"
  | "@id"
  | "@hidden"
  | "@segments";

/** What the headline says, as a key and its values; `headline` is its English for the transcript. */
export interface LookupMessage {
  key:
    | "member"
    | "notMember"
    | "show"
    | "hiddenNone"
    | "hiddenSome"
    | "environment"
    | "environmentUnknown4x"
    | "environmentNone"
    | "environmentNotListed"
    | "itemNotFound"
    | "segmentNotFound"
    | "itemAmbiguous"
    | "segmentAmbiguous"
    | "fileUnread";
  values: Record<string, string | number>;
}

export interface LookupResult {
  kind: "lookup";
  question: LookupQuestion["kind"];
  aptyVersion: "4.x" | "5.x";
  source: LookupSource;
  /** answered; ambiguous (one question to the SE); not_found; no_files. */
  status: "answered" | "ambiguous" | "not_found" | "no_files";
  headline: string;
  message: LookupMessage;
  columns: LookupColumn[];
  rows: string[][];
  /** With `ambiguous`: what to ask, and the names to choose from. */
  ask?: { what: "workflow" | "segment"; options: string[] };
  /** The files read, by name. */
  files: string[];
  /** K27, F4: the site, as a key; shown in the panel only. */
  siteKey?: string;
}

interface Item {
  id: string;
  names: string[];
  hidden: boolean;
}

interface Segment {
  id: string;
  name: string;
  members: string[];
  /** 5.x only; undefined where the files do not say. */
  active?: boolean;
}

function itemsOf(evidence: ClientEvidence, version: "4.x" | "5.x"): Item[] {
  if (version === "4.x") {
    return records(jsonOf(evidence, "flow.json")).map((flow) => ({
      id: String(flow.id ?? ""),
      names: flowNames(flow),
      hidden: Boolean(flow.hideInWidget),
    }));
  }
  return records(jsonOf(evidence, "workflow.json")).map((item) => ({
    id: text(item.sourceId) ?? text(item.id) ?? "",
    names: namesOf(item),
    hidden: item.hideFromWidget === true,
  }));
}

function segmentsOf(
  evidence: ClientEvidence,
  version: "4.x" | "5.x",
): Segment[] {
  if (version === "4.x") {
    return records(jsonOf(evidence, "segments.json")).map((s: Rec) => ({
      id: String(s.id ?? ""),
      name: text(s.name) ?? String(s.id ?? ""),
      members: (Array.isArray(s.flows) ? s.flows : []).map(String),
    }));
  }
  return records(jsonOf(evidence, "segment.json")).map((s: Rec) => ({
    id: text(s.id) ?? "",
    name: text(s.name) ?? text(s.id) ?? "",
    members: texts(s.workflowIds),
    active: typeof s.isActive === "boolean" ? s.isActive : undefined,
  }));
}

/** By exact name, ignoring case and punctuation; then by a name that holds it. */
function find<T>(
  all: T[],
  wanted: string,
  namesOfIt: (item: T) => string[],
): T[] {
  const key = normalizedName(wanted);
  if (!key) return [];
  const exact = all.filter((item) =>
    namesOfIt(item).some((name) => normalizedName(name) === key),
  );
  if (exact.length > 0) return exact;
  return all.filter((item) =>
    namesOfIt(item).some((name) => normalizedName(name).includes(key)),
  );
}

const first = (item: Item) => item.names[0] ?? item.id;
const yesNo = (value: boolean | undefined): LookupWord =>
  value === undefined ? "@unknown" : value ? "@yes" : "@no";

function sourceOf(evidence: ClientEvidence): LookupSource {
  return evidence.fromCdn ? "cdn" : evidence.fromCapture ? "capture" : "client";
}

const ENGLISH: Record<
  LookupMessage["key"],
  (v: Record<string, string | number>) => string
> = {
  member: (v) => `"${v.item}" is in the "${v.segment}" segment.`,
  notMember: (v) => `"${v.item}" is not in the "${v.segment}" segment.`,
  show: (v) => `"${v.item}" in ${v.file}.`,
  hiddenNone: (v) => `No workflow in ${v.file} is hidden from the widget.`,
  hiddenSome: (v) =>
    `${v.count} of ${v.total} workflows are hidden from the widget.`,
  environment: (v) => `This tab's Apty Client loaded the ${v.env} environment.`,
  environmentUnknown4x: () =>
    "The 4.x content files do not name the environment.",
  environmentNone: () => "The content files' path names no environment.",
  environmentNotListed: () =>
    "The environment in the content files' path is not in app-urls.json.",
  itemNotFound: (v) => `No workflow named "${v.item}" is in ${v.file}.`,
  segmentNotFound: (v) => `No segment named "${v.segment}" is in ${v.file}.`,
  itemAmbiguous: (v) => `${v.count} workflows match "${v.item}". Which one?`,
  segmentAmbiguous: (v) =>
    `${v.count} segments match "${v.segment}". Which one?`,
  fileUnread: (v) => `${v.file} could not be read (${v.status}).`,
};

/** The answer to `question` from the content files in `evidence`. */
export function answerLookup(
  question: LookupQuestion,
  evidence: ClientEvidence,
): LookupResult {
  const version: "4.x" | "5.x" =
    playerVersionOf(evidence) === "4.x" ? "4.x" : "5.x";
  const itemFile = version === "4.x" ? "flow.json" : "workflow.json";
  const segmentFile = version === "4.x" ? "segments.json" : "segment.json";
  const result = (
    status: LookupResult["status"],
    key: LookupMessage["key"],
    values: Record<string, string | number>,
    files: string[],
    columns: LookupColumn[] = [],
    rows: string[][] = [],
    ask?: LookupResult["ask"],
  ): LookupResult => ({
    kind: "lookup",
    question: question.kind,
    aptyVersion: version,
    source: sourceOf(evidence),
    status,
    headline: ENGLISH[key](values),
    message: { key, values },
    columns,
    rows,
    ...(ask ? { ask } : {}),
    files,
  });
  const read = (name: string) => evidence.files[name]?.status === "ok";
  const unread = (file: string, files: string[]) =>
    result(
      "no_files",
      "fileUnread",
      { file, status: evidence.files[file]?.status ?? "not_observed" },
      files,
    );

  if (question.kind === "environment") {
    if (version === "4.x") {
      return result("not_found", "environmentUnknown4x", {}, []);
    }
    if (!evidence.envId) return result("not_found", "environmentNone", {}, []);
    const id = evidence.envId.replace(/^env-/, "");
    const env = records(jsonOf(evidence, "app-urls.json"))
      .flatMap((app) => records(app.environments))
      .find((e) => e.id === id);
    if (!env) {
      return result("not_found", "environmentNotListed", {}, ["app-urls.json"]);
    }
    const name = text(env.name) ?? id;
    return result(
      "answered",
      "environment",
      { env: name },
      ["app-urls.json"],
      ["environment", "id"],
      [[name, id]],
    );
  }

  if (!read(itemFile)) return unread(itemFile, [itemFile]);
  const items = itemsOf(evidence, version);

  if (question.kind === "hidden") {
    const hidden = items.filter((item) => item.hidden);
    return hidden.length === 0
      ? result("answered", "hiddenNone", { file: itemFile }, [itemFile])
      : result(
          "answered",
          "hiddenSome",
          { count: hidden.length, total: items.length },
          [itemFile],
          ["workflow", "id"],
          hidden.map((item) => [first(item), item.id]),
        );
  }

  const matches = find(items, question.item, (item) => item.names);
  if (matches.length === 0) {
    return result(
      "not_found",
      "itemNotFound",
      { item: question.item, file: itemFile },
      [itemFile],
    );
  }
  if (matches.length > 1) {
    return result(
      "ambiguous",
      "itemAmbiguous",
      { count: matches.length, item: question.item },
      [itemFile],
      [],
      [],
      { what: "workflow", options: matches.map(first) },
    );
  }
  const item = matches[0] as Item;
  const segments = read(segmentFile)
    ? segmentsOf(evidence, version)
    : undefined;

  if (question.kind === "show") {
    const listing = segments?.filter((s) => s.members.includes(item.id));
    return result(
      "answered",
      "show",
      { item: first(item), file: itemFile },
      [itemFile, ...(segments ? [segmentFile] : [])],
      ["field", "value"],
      [
        ["@name", first(item)],
        ["@id", item.id],
        ["@hidden", yesNo(item.hidden)],
        [
          "@segments",
          listing === undefined
            ? "@notRead"
            : listing.map((s) => s.name).join(", ") || "@none",
        ],
      ],
    );
  }

  if (!segments) return unread(segmentFile, [itemFile, segmentFile]);
  const segmentMatches = find(segments, question.segment, (s) => [s.name]);
  if (segmentMatches.length === 0) {
    return result(
      "not_found",
      "segmentNotFound",
      { segment: question.segment, file: segmentFile },
      [itemFile, segmentFile],
    );
  }
  if (segmentMatches.length > 1) {
    return result(
      "ambiguous",
      "segmentAmbiguous",
      { count: segmentMatches.length, segment: question.segment },
      [itemFile, segmentFile],
      [],
      [],
      { what: "segment", options: segmentMatches.map((s) => s.name) },
    );
  }
  const segment = segmentMatches[0] as Segment;
  const listed = segment.members.includes(item.id);
  return result(
    "answered",
    listed ? "member" : "notMember",
    { item: first(item), segment: segment.name },
    [itemFile, segmentFile],
    ["workflow", "segment", "listed", "segmentOn"],
    [[first(item), segment.name, yesNo(listed), yesNo(segment.active)]],
  );
}

/** The answer in plain text, as the session keeps it for the model's later turns. */
const WORDS: Record<LookupWord, string> = {
  "@yes": "yes",
  "@no": "no",
  "@unknown": "not in the files",
  "@none": "none",
  "@notRead": "not read",
  "@name": "name",
  "@id": "id",
  "@hidden": "hidden from the widget",
  "@segments": "segments that list it",
};

export function lookupTranscript(result: LookupResult): string {
  const word = (cell: string) => WORDS[cell as LookupWord] ?? cell;
  const table = result.rows
    .map((row) =>
      row.map((cell, i) => `${result.columns[i]}: ${word(cell)}`).join("; "),
    )
    .join("\n");
  return [
    `Lookup from the Apty ${result.aptyVersion} content files (${result.files.join(", ")}, source ${result.source}): ${result.headline}`,
    table,
    result.ask
      ? `Ask the user which ${result.ask.what}: ${result.ask.options.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
