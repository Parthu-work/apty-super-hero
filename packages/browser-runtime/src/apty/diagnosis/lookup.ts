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

export type LookupQuestion = (
  | { kind: "membership"; item: string; segment: string }
  | { kind: "show"; item: string }
  | { kind: "environment" }
  | { kind: "hidden"; item?: string }
  | { kind: "segmentMembers"; segment: string }
  | { kind: "itemSegments"; item: string }
) & {
  /** K28, F2: the workflow or segment the SE picked among same-named ones. */
  itemId?: string;
  segmentId?: string;
  /** K28, F3: the version the SE named when the files did not tell. */
  version?: "4.x" | "5.x";
};

const QUOTED =
  /["“”]([^"“”]+)["“”]|(?:^|\s)['‘’]([^'‘’]+)['‘’](?=\s|$|[?.!,])/g;
const SLOT = /^\uE000(\d+)\uE000$/;
const CONTENT_FILE =
  "(?:work)?flows?\\.json|segments?\\.json|rules?\\.json|app-urls\\.json";
const FILE_PHRASE = new RegExp(
  `(?:\\b(?:from|in|using|of|per)\\s+)?(?:the\\s+)?\\b(?:${CONTENT_FILE})(?:\\s+file)?`,
  "gi",
);
const FILLER = [
  /^(?:please\s+)/i,
  /^(?:(?:can|could|would)\s+you\s+(?:please\s+)?)/i,
  /^(?:(?:check|see|verify|confirm|tell\s+me|find\s+out)\s+(?:if|whether)\s+)/i,
  /^(?:check\s+)/i,
  /\s+please$/i,
];
const ASKS = /^(?:is|are|does|do|whether|if)\s/i;

/** Words that never name a workflow or segment on their own. */
const NOT_A_NAME = new Set([
  "widget",
  "the widget",
  "segment",
  "segments",
  "workflow",
  "workflows",
  "flow",
  "flows",
  "tab",
  "this tab",
  "page",
  "this page",
  "tooltip",
  "client",
  "apty",
  "apty client",
  "environment",
  "it",
  "this",
  "that",
  "them",
]);
/** A name with one of these words is a sentence, not a name. */
const SENTENCE_WORD =
  /\b(?:how|why|what|where|when|which|not|isn't|doesn't|don't|can't|i|me|my|you|your|we|our)\b/i;
/** Without a "workflow" marker or quotes, these words make "show X" something else. */
const NOT_CONTENT_WORD =
  /\b(?:errors?|console|logs?|network|requests?|har|screenshots?|dom|html|evidence|cases?|settings?|options|json|toggle|widget|tooltip|balloon|steps?|calls?|files?|version)\b/i;
/** Without a marker or quotes, a "show X" name holding one of these is a request, not a name. */
const NOT_A_BARE_NAME =
  /\b(?:and|or|on|at|from|to|for|with|of|by|about|again|this|that|these|those|its?|data|everything|all|button|buttons|field|fields|link|links|element|elements|selector|summari[sz]e[ds]?|summary|text|content|details|info)\b/i;
/** A bare name is written as Apty shows it: two or more words, each capitalised or a number ("Alpha Ledger Page"). */
const TITLE_CASE =
  /^(?:[\p{Lu}\d][\p{L}\d'’&-]*)(?:\s+[\p{Lu}\d][\p{L}\d'’&-]*)+$/u;
const MAX_NAME_WORDS = 8;

interface Name {
  value: string;
  quoted: boolean;
}

interface Cleaned {
  text: string;
  slots: string[];
  asked: boolean;
  /** The message named a content file: "get segments.json …" fetches it. */
  namedFile: boolean;
}

function cleanQuestion(input: string): Cleaned | undefined {
  const slots: string[] = [];
  let text = input
    .trim()
    .replace(/[?.!]+$/, "")
    .replace(QUOTED, (whole, a, b) => {
      const lead = whole.startsWith(" ") ? " " : "";
      slots.push(String(a ?? b).trim());
      return `${lead}\uE000${slots.length - 1}\uE000`;
    })
    .replace(/\s+/g, " ")
    .trim();
  let asked = false;
  const withoutFiles = text.replace(FILE_PHRASE, " ").replace(/\s+/g, " ");
  const namedFile = withoutFiles.trim() !== text;
  text = withoutFiles.trim();
  for (let again = true; again; ) {
    again = false;
    for (const filler of FILLER) {
      const next = text.replace(filler, "");
      if (next !== text) {
        asked ||= /check|see|verify|confirm|tell|find/i.test(
          text.slice(0, text.length - next.length),
        );
        text = next.trim();
        again = true;
      }
    }
  }
  if (!text) return undefined;
  return { text, slots, asked: asked || ASKS.test(text), namedFile };
}

const ITEM_MARK = /^(?:work)?flow$/i;
const SEGMENT_MARK = /^segment$/i;

/**
 * One side of a split: the leading article and auxiliaries dropped, and a
 * "workflow" or "segment" marker before or after the name noted.
 */
function nameOf(
  raw: string,
  slots: string[],
  mark: RegExp,
  other: RegExp,
  { lead = /^(?:is|are|does|do|whether|if)\s+/i } = {},
): (Name & { marked: boolean }) | undefined {
  let words = raw.replace(lead, "").trim().split(" ").filter(Boolean);
  let marked = false;
  const strip = () => {
    if (/^(?:the|a|an)$/i.test(words[0] ?? "")) words = words.slice(1);
    if (words.length > 1 && mark.test(words[0] ?? "")) {
      words = words.slice(1);
      marked = true;
    }
    if (words.length > 1 && mark.test(words[words.length - 1] ?? "")) {
      words = words.slice(0, -1);
      marked = true;
    }
    if (/^(?:entry|record|details)$/i.test(words[words.length - 1] ?? "")) {
      words = words.slice(0, -1);
    }
  };
  strip();
  strip();
  if (words.length === 0) return undefined;
  if (words.some((word) => mark.test(word) || other.test(word))) {
    return undefined;
  }
  const joined = words.join(" ");
  const slot = SLOT.exec(joined);
  if (slot) {
    return { value: slots[Number(slot[1])] ?? "", quoted: true, marked };
  }
  if (joined.includes("\uE000")) return undefined;
  if (
    words.length > MAX_NAME_WORDS ||
    NOT_A_NAME.has(joined.toLowerCase()) ||
    SENTENCE_WORD.test(joined)
  ) {
    return undefined;
  }
  return { value: joined, quoted: false, marked };
}

const itemName = (raw: string, slots: string[]) =>
  nameOf(raw, slots, ITEM_MARK, SEGMENT_MARK);
const segmentName = (raw: string, slots: string[]) =>
  nameOf(raw, slots, SEGMENT_MARK, ITEM_MARK);

const IN_VERBS =
  "(?:is\\s+|are\\s+)?(?:(?:present|listed|included|contained|found|available|visible|shown|enabled)\\s+)?(?:in|inside|under|within)|(?:is\\s+|are\\s+)?(?:visible|shown|available|enabled)\\s+(?:to|for)|(?:does\\s+)?belongs?\\s+to|(?:is\\s+)?(?:assigned|added|mapped|attached|linked)\\s+to|(?:is\\s+)?(?:a\\s+)?(?:part|member)\\s+of";
const HOLDS_VERBS = "includes?|contains?|has|have|lists?|holds?|covers?";

/**
 * Every way to split `text` around a verb in `verbs`, rightmost first: the
 * verb's left side and its right side.
 */
function splits(text: string, verbs: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const verb = new RegExp(`\\s(?:${verbs})(?=\\s)`, "gi");
  for (const match of text.matchAll(verb)) {
    out.push([
      text.slice(0, match.index),
      text.slice((match.index ?? 0) + match[0].length + 1),
    ]);
  }
  return out.reverse();
}

/**
 * The rightmost split whose names both parse and one of which carries a
 * "workflow" or "segment" marker (or both are quoted). Names that hold "in"
 * themselves ("Sign in", "Order in Progress") keep working because every
 * split is tried.
 */
const pick = <T extends { marked: boolean }>(
  candidates: Array<T | undefined>,
) => candidates.find((c) => c?.marked);

/**
 * A statement ("Sign in workflow in All Users segment", K29 B8) routes only
 * when it marks both names: the workflow and the segment.
 */
function membership(cleaned: Cleaned): LookupQuestion | undefined {
  const { text, slots, asked } = cleaned;
  const itemFirst = splits(text, IN_VERBS).map(([left, right]) => {
    const item = itemName(left, slots);
    const segment = segmentName(right, slots);
    if (!item || !segment) return undefined;
    return {
      item: item.value,
      segment: segment.value,
      marked: asked
        ? item.marked || segment.marked || (item.quoted && segment.quoted)
        : item.marked && segment.marked,
    };
  });
  if (!asked) {
    const stated = pick(itemFirst);
    return stated
      ? { kind: "membership", item: stated.item, segment: stated.segment }
      : undefined;
  }
  const segmentFirst = splits(text, HOLDS_VERBS).map(([left, right]) => {
    const segment = segmentName(left, slots);
    const item = itemName(right, slots);
    if (!item || !segment) return undefined;
    return {
      item: item.value,
      segment: segment.value,
      marked: segment.marked || item.marked || (item.quoted && segment.quoted),
    };
  });
  const found = pick(itemFirst) ?? pick(segmentFirst);
  return found
    ? { kind: "membership", item: found.item, segment: found.segment }
    : undefined;
}

const LIST_LEAD =
  "(?:which|what)|(?:list|show(?:\\s+me)?|get)(?:\\s+(?:all|the|all\\s+the))?";

const SEGMENT_MEMBERS = [
  new RegExp(
    `^(?:${LIST_LEAD})\\s+(?:work)?flows\\s+(?:(?:are|is)\\s+)?(?:${IN_VERBS}|of)\\s+(.+)$`,
    "i",
  ),
  /^(?:which|what)\s+(?:work)?flows\s+(?:does|do)\s+(.+?)\s+(?:include|contain|have|list|hold)$/i,
];
const ITEM_SEGMENTS = [
  new RegExp(
    `^(?:which|what)\\s+segments?\\s+(?:is|are|does|do)\\s+(.+?)\\s+(?:${IN_VERBS}|belong\\s+to)$`,
    "i",
  ),
  new RegExp(
    `^(?:which|what)\\s+segments?\\s+(?:${HOLDS_VERBS})\\s+(.+)$`,
    "i",
  ),
  /^(?:list|show(?:\s+me)?)\s+(?:the\s+)?segments\s+(?:of|for)\s+(.+)$/i,
];
const SHOW = /^(?:show(?:\s+me)?|get|open|display|find)\s+(.+)$/i;
const SHOW_BARE = /^show(?:\s+me)?\s/i;
const WHAT_IS = /^what\s+is\s+(?:the\s+)?((?:work)?flow\s+.+)$/i;
const ENVIRONMENT =
  /^(?:which|what)\s+(?:apty\s+)?environment\s+(?:am\s+i\s+(?:on|in|using)|is\s+(?:this|the|my)\s+(?:tab|page|site|(?:apty\s+)?client)(?:\s+(?:on|in|using|loading|loaded))?|(?:is|does)\s+(?:this|the|my)\s+(?:tab|page|site|(?:apty\s+)?client)\s+(?:use|load))$/i;
const HIDDEN_LIST = [
  /^(?:list|show(?:\s+me)?|get)\s+(?:all\s+)?(?:the\s+)?hidden\s+(?:work)?flows$/i,
  /^(?:which|what)\s+(?:work)?flows\s+are\s+(?:hidden\s+(?:from|in)|not\s+(?:visible|shown|showing)\s+in)\s+(?:the\s+)?widget$/i,
];
const HIDDEN_ONE =
  /^is\s+(.+?)\s+hidden(?:\s+(?:from|in)\s+(?:the\s+)?widget)?$/i;

/** The lookup a message asks for, or undefined (K28, F1: a small parser, precision first). */
export function routeLookup(input: string): LookupQuestion | undefined {
  const cleaned = cleanQuestion(input);
  if (!cleaned) return undefined;
  const { text, slots } = cleaned;
  if (ENVIRONMENT.test(text)) return { kind: "environment" };
  if (HIDDEN_LIST.some((pattern) => pattern.test(text))) {
    return { kind: "hidden" };
  }
  const hiddenOne = HIDDEN_ONE.exec(text);
  if (hiddenOne?.[1]) {
    const item = itemName(hiddenOne[1], slots);
    return item && (item.marked || item.quoted)
      ? { kind: "hidden", item: item.value }
      : undefined;
  }
  for (const pattern of ITEM_SEGMENTS) {
    const match = pattern.exec(text);
    const item = match?.[1] ? itemName(match[1], slots) : undefined;
    if (item) return { kind: "itemSegments", item: item.value };
  }
  for (const pattern of SEGMENT_MEMBERS) {
    const match = pattern.exec(text);
    const segment = match?.[1] ? segmentName(match[1], slots) : undefined;
    if (segment) return { kind: "segmentMembers", segment: segment.value };
  }
  const asMember = membership(cleaned);
  if (asMember) return asMember;
  const shown = (SHOW.exec(text) ?? WHAT_IS.exec(text))?.[1];
  const item = shown ? itemName(shown, slots) : undefined;
  if (!item) return undefined;
  if (item.marked || item.quoted) return { kind: "show", item: item.value };
  const bare =
    SHOW_BARE.test(text) &&
    TITLE_CASE.test(item.value) &&
    !cleaned.namedFile &&
    !NOT_CONTENT_WORD.test(item.value) &&
    !NOT_A_BARE_NAME.test(item.value);
  return bare ? { kind: "show", item: item.value } : undefined;
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
  | "hidden"
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
    | "itemHidden"
    | "itemNotHidden"
    | "segmentMembers"
    | "segmentEmpty"
    | "itemSegments"
    | "itemSegmentsNone"
    | "environment"
    | "environmentUnknown4x"
    | "environmentNone"
    | "environmentNotListed"
    | "itemNotFound"
    | "segmentNotFound"
    | "itemAmbiguous"
    | "segmentAmbiguous"
    | "versionUnknown"
    | "clientNotConnected"
    | "fileNotReported"
    | "fileUnread";
  values: Record<string, string | number>;
}

/**
 * K28, F2: one of several same-named workflows or segments (or, F3, the
 * two Apty versions), with what tells it apart and its answer, so the SE
 * picks it with one click and no new request.
 */
export interface LookupChoice {
  id: string;
  name: string;
  active?: boolean;
  hidden?: boolean;
  /** A segment's workflow count. */
  workflows?: number;
  /** The choice in English, as the transcript gives it. */
  label: string;
  answer: LookupResult;
}

export interface LookupResult {
  kind: "lookup";
  question: LookupQuestion["kind"];
  /** The question as routed, to answer it again from other evidence. */
  asked: LookupQuestion;
  aptyVersion: "4.x" | "5.x" | "unknown";
  source: LookupSource;
  /** answered; ambiguous (one question to the SE); not_found; no_files. */
  status: "answered" | "ambiguous" | "not_found" | "no_files";
  headline: string;
  message: LookupMessage;
  columns: LookupColumn[];
  rows: string[][];
  /** With `ambiguous`: what to ask, and the choices. */
  ask?: { what: "workflow" | "segment" | "version"; options: LookupChoice[] };
  /** K28, F3: the files are not there yet; offer Get the evidence and a tab reload. */
  offerEvidence?: boolean;
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

type Version = "4.x" | "5.x";

/** Every content file a lookup reads, in either version. */
export const LOOKUP_FILES = [
  "workflow.json",
  "segment.json",
  "app-urls.json",
  "flow.json",
  "segments.json",
] as const;

const FILES: Record<Version, { item: string; segment: string }> = {
  "4.x": { item: "flow.json", segment: "segments.json" },
  "5.x": { item: "workflow.json", segment: "segment.json" },
};

function itemsOf(evidence: ClientEvidence, version: Version): Item[] {
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

function segmentsOf(evidence: ClientEvidence, version: Version): Segment[] {
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

/** By id when the SE picked one; else by exact name, ignoring case and punctuation; then by a name that holds it. */
function find<T extends { id: string }>(
  all: T[],
  wanted: string,
  id: string | undefined,
  namesOfIt: (item: T) => string[],
): T[] {
  if (id !== undefined) return all.filter((item) => item.id === id);
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
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

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
  itemHidden: (v) => `"${v.item}" is hidden from the widget.`,
  itemNotHidden: (v) => `"${v.item}" is not hidden from the widget.`,
  segmentMembers: (v) =>
    `The "${v.segment}" segment lists ${plural(Number(v.count), "workflow")}.`,
  segmentEmpty: (v) => `The "${v.segment}" segment lists no workflow.`,
  itemSegments: (v) =>
    `"${v.item}" is listed in ${plural(Number(v.count), "segment")}.`,
  itemSegmentsNone: (v) => `No segment lists "${v.item}".`,
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
  versionUnknown: () => "Which Apty version does this tenant run?",
  clientNotConnected: () =>
    "The Apty Client is not connected, so its content files cannot be read.",
  fileNotReported: (v) => `The Apty Client has not reported ${v.file} yet.`,
  fileUnread: (v) => `${v.file} could not be read (${v.status}).`,
};

const ok = (evidence: ClientEvidence, name: string) =>
  evidence.files[name]?.status === "ok";

/**
 * K28, F3: the version the files tell, else the one whose files are
 * present, else undefined (both or neither: ask).
 */
function versionOf(
  evidence: ClientEvidence,
  asked: Version | undefined,
): Version | undefined {
  if (asked) return asked;
  const told = playerVersionOf(evidence);
  if (told !== "unknown") return told;
  const four = ok(evidence, "flow.json") || ok(evidence, "segments.json");
  const five = ok(evidence, "workflow.json") || ok(evidence, "segment.json");
  if (four === five) return undefined;
  return four ? "4.x" : "5.x";
}

/** The answer to `question` from the content files in `evidence`. */
export function answerLookup(
  question: LookupQuestion,
  evidence: ClientEvidence,
): LookupResult {
  const version = versionOf(evidence, question.version);
  const result = (
    status: LookupResult["status"],
    key: LookupMessage["key"],
    values: Record<string, string | number>,
    files: string[],
    columns: LookupColumn[] = [],
    rows: string[][] = [],
    extra: Pick<LookupResult, "ask" | "offerEvidence"> = {},
  ): LookupResult => ({
    kind: "lookup",
    question: question.kind,
    asked: question,
    aptyVersion: version ?? "unknown",
    source: sourceOf(evidence),
    status,
    headline: ENGLISH[key](values),
    message: { key, values },
    columns,
    rows,
    ...extra,
    files,
  });
  const choose = (
    what: "workflow" | "segment",
    key: "itemAmbiguous" | "segmentAmbiguous",
    values: Record<string, string | number>,
    files: string[],
    options: Array<Omit<LookupChoice, "label" | "answer">>,
    pick: (id: string) => LookupQuestion,
  ) =>
    result("ambiguous", key, values, files, [], [], {
      ask: {
        what,
        options: options.map((option) => ({
          ...option,
          label: choiceLabel(option),
          answer: answerLookup(pick(option.id), evidence),
        })),
      },
    });
  const missing = (file: string, files: string[]) => {
    if (!evidence.connection.ok) {
      return result("no_files", "clientNotConnected", {}, files, [], [], {
        offerEvidence: true,
      });
    }
    const loaded = evidence.files[file];
    if (!loaded || loaded.status === "not_observed") {
      return result("no_files", "fileNotReported", { file }, files, [], [], {
        offerEvidence: true,
      });
    }
    const status = loaded.httpStatus
      ? `${loaded.status} ${loaded.httpStatus}`
      : loaded.status;
    return result("no_files", "fileUnread", { file, status }, files);
  };

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

  if (!version) {
    if (!evidence.connection.ok) {
      return result("no_files", "clientNotConnected", {}, [], [], [], {
        offerEvidence: true,
      });
    }
    return result("ambiguous", "versionUnknown", {}, [], [], [], {
      ask: {
        what: "version",
        options: (["4.x", "5.x"] as const).map((v) => ({
          id: v,
          name: `Apty ${v}`,
          label: `Apty ${v}`,
          answer: answerLookup({ ...question, version: v }, evidence),
        })),
      },
    });
  }

  const itemFile = FILES[version].item;
  const segmentFile = FILES[version].segment;
  const segments = ok(evidence, segmentFile)
    ? segmentsOf(evidence, version)
    : undefined;

  const segmentAsked = (
    wanted: string,
    files: string[],
    then: (segment: Segment) => LookupResult,
  ): LookupResult => {
    if (!segments) return missing(segmentFile, files);
    const matches = find(segments, wanted, question.segmentId, (s) => [s.name]);
    if (matches.length === 0) {
      return result(
        "not_found",
        "segmentNotFound",
        { segment: wanted, file: segmentFile },
        files,
      );
    }
    if (matches.length > 1) {
      return choose(
        "segment",
        "segmentAmbiguous",
        { count: matches.length, segment: wanted },
        files,
        matches.map((s) => ({
          id: s.id,
          name: s.name,
          ...(s.active === undefined ? {} : { active: s.active }),
          workflows: s.members.length,
        })),
        (segmentId) => ({ ...question, segmentId }),
      );
    }
    return then(matches[0] as Segment);
  };

  if (question.kind === "segmentMembers") {
    const files = [segmentFile, itemFile];
    return segmentAsked(question.segment, files, (segment) => {
      const items = ok(evidence, itemFile) ? itemsOf(evidence, version) : [];
      const nameOfId = (id: string) => {
        const item = items.find((i) => i.id === id);
        return item ? first(item) : id;
      };
      return segment.members.length === 0
        ? result("answered", "segmentEmpty", { segment: segment.name }, files)
        : result(
            "answered",
            "segmentMembers",
            { segment: segment.name, count: segment.members.length },
            files,
            ["workflow", "id"],
            segment.members.map((id) => [nameOfId(id), id]),
          );
    });
  }

  if (!ok(evidence, itemFile)) return missing(itemFile, [itemFile]);
  const items = itemsOf(evidence, version);

  if (question.kind === "hidden" && question.item === undefined) {
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

  const wantedItem = question.item ?? "";
  const matches = find(
    items,
    wantedItem,
    question.itemId,
    (item) => item.names,
  );
  if (matches.length === 0) {
    return result(
      "not_found",
      "itemNotFound",
      { item: wantedItem, file: itemFile },
      [itemFile],
    );
  }
  if (matches.length > 1) {
    return choose(
      "workflow",
      "itemAmbiguous",
      { count: matches.length, item: wantedItem },
      [itemFile],
      matches.map((item) => ({
        id: item.id,
        name: first(item),
        hidden: item.hidden,
      })),
      (itemId) => ({ ...question, itemId }),
    );
  }
  const item = matches[0] as Item;

  if (question.kind === "hidden") {
    return result(
      "answered",
      item.hidden ? "itemHidden" : "itemNotHidden",
      { item: first(item) },
      [itemFile],
      ["workflow", "id", "hidden"],
      [[first(item), item.id, yesNo(item.hidden)]],
    );
  }

  if (question.kind === "itemSegments") {
    const files = [itemFile, segmentFile];
    if (!segments) return missing(segmentFile, files);
    const listing = segments.filter((s) => s.members.includes(item.id));
    return listing.length === 0
      ? result("answered", "itemSegmentsNone", { item: first(item) }, files)
      : result(
          "answered",
          "itemSegments",
          { item: first(item), count: listing.length },
          files,
          ["segment", "id", "segmentOn"],
          listing.map((s) => [s.name, s.id, yesNo(s.active)]),
        );
  }

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

  return segmentAsked(question.segment, [itemFile, segmentFile], (segment) => {
    const listed = segment.members.includes(item.id);
    return result(
      "answered",
      listed ? "member" : "notMember",
      { item: first(item), segment: segment.name },
      [itemFile, segmentFile],
      ["workflow", "segment", "listed", "segmentOn"],
      [[first(item), segment.name, yesNo(listed), yesNo(segment.active)]],
    );
  });
}

/** "Managers (s-2, inactive, 1 workflow)": what tells same-named choices apart. */
function choiceLabel(choice: Omit<LookupChoice, "label" | "answer">): string {
  const parts = [
    choice.id,
    ...(choice.active === undefined
      ? []
      : [choice.active ? "active" : "inactive"]),
    ...(choice.hidden ? ["hidden"] : []),
    ...(choice.workflows === undefined
      ? []
      : [plural(choice.workflows, "workflow")]),
  ];
  return `${choice.name} (${parts.join(", ")})`;
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

/** K29, B8: what the lookup read, in words, also when nothing was read. */
function lookupHeading(result: LookupResult): string {
  if (result.message.key === "clientNotConnected") {
    return "Lookup: the Apty Client is not connected.";
  }
  if (result.aptyVersion === "unknown") {
    return "Lookup: the Apty version is not known.";
  }
  const files = result.files.length > 0 ? `${result.files.join(", ")}, ` : "";
  return `Lookup from the Apty ${result.aptyVersion} content files (${files}source ${result.source}):`;
}

export function lookupTranscript(result: LookupResult): string {
  const word = (cell: string) => WORDS[cell as LookupWord] ?? cell;
  const table = result.rows
    .map((row) =>
      row.map((cell, i) => `${result.columns[i]}: ${word(cell)}`).join("; "),
    )
    .join("\n");
  return [
    `${lookupHeading(result)} ${result.headline}`,
    table,
    result.ask
      ? `Ask the user which ${result.ask.what}: ${result.ask.options.map((o) => o.label).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
