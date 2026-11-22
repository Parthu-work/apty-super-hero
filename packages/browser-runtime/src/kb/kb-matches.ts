/**
 * The KB matches card (KB-RAG K6, K16): for any message no check pack
 * claims, the loaded pack's best cards, one chunk each, answered with no
 * model call when the pack covers it (or a stub when only a card not yet
 * written does). A bare "how do I configure X" with no symptom is not a KB
 * question (D-KB1): it is left to the model. A question mostly outside the
 * Latin script cannot match the English cards: with no model to take it,
 * the user is told so.
 *
 * Every search ends in a typed outcome (KB-RAG K25, A2), so the chat can
 * say why no card was shown: no pack, not covered with its numbers, or an
 * error with its code. Nothing is swallowed.
 *
 * A question naming a content file of one version (flow.json is 4.x,
 * workflow.json 5.x) searches that version's pack (KB-RAG K29, B3); on a
 * site of the other version the answer says what that version calls the
 * file and adds its card for it when the pack has one.
 */
import {
  type KbDecision,
  type KbDeliveryFailure,
  type KbIndex,
  kbSourceTag,
  type NamedFileVersion,
  namedFileVersion,
  packIdOf,
} from "@apty/agent-core";
import { measured, PERF } from "../runtime/perf-marks.js";
import {
  type KbIndexSource,
  type KbTabVersion,
  type KbToolResult,
  type KbUnusablePack,
  kbToolResultOf,
  sharedKbIndexSource,
  unusablePackOf,
} from "./kb-index.js";
import { isBareHowTo, isMostlyNonLatin } from "./kb-intent.js";
import { type KbDeliveryNote, sharedKbDeliveryNote } from "./kb-pack-sync.js";

const MAX_QUERY_CHARS = 300;
const KB_MATCHES = 3;

export interface KbMatchesOptions {
  /** A model is configured, so a question the cards cannot match goes to it. */
  modelAvailable?: boolean;
  /** The tab's Apty version: its pack and the common cards, or every pack when unknown. */
  version?: KbTabVersion;
  /** K26 (D4): why a policy-delivered pack is missing; this browser's record by default. */
  delivery?: KbDeliveryNote;
}

/** A pack a search read: its version and sha256 prefix. */
export interface KbSearchedPack {
  version: string;
  sha256: string;
  keyId?: string | null;
  expiresAt?: string | null;
}

export type KbOutcome =
  | { kind: "answer"; result: KbToolResult; packs: KbSearchedPack[] }
  | {
      /** K27, F2: the question names a setting no card has; answered by the KB with the closest cards, not by the model. */
      kind: "unknown_setting";
      result: KbToolResult;
      coverage: number;
      min: number;
      topPageId?: string;
      version: KbTabVersion;
      packs: KbSearchedPack[];
    }
  | { kind: "how_to" }
  | { kind: "non_english" }
  | { kind: "no_pack"; version: KbTabVersion; delivery?: KbDeliveryFailure }
  | {
      kind: "not_covered";
      reason: NonNullable<KbToolResult["reason"]>;
      coverage: number;
      min: number;
      topPageId?: string;
      /** K27, E7: the cards offered to the SE as "closest, may not match". */
      closestPageIds?: string[];
      version: KbTabVersion;
      packs: KbSearchedPack[];
    }
  | {
      kind: "error";
      code: "pack_read_failed" | "search_failed";
      message: string;
    }
  | {
      kind: "pack_unusable";
      reason: KbUnusablePack["reason"];
      version: KbUnusablePack["aptyVersion"];
      date: string | null;
      delivery?: KbDeliveryFailure;
    };

function failed(
  code: "pack_read_failed" | "search_failed",
  error: unknown,
): KbOutcome {
  console.error(`[kb] ${code}`, error);
  return {
    kind: "error",
    code,
    message: error instanceof Error ? error.name : "Error",
  };
}

const bareName = (file: string) => file.replace("<id>", "").toLowerCase();

/** The question asking for the counterpart file in place of the named one. */
function askedFor(text: string, named: NamedFileVersion): string {
  const at = text.toLowerCase().indexOf(named.file);
  if (at < 0) return bareName(named.counterpart);
  return `${text.slice(0, at)}${bareName(named.counterpart)}${text.slice(at + named.file.length)}`;
}

/**
 * The site's version's card for the counterpart file, when its pack has a
 * covered card that names it; undefined otherwise.
 */
async function counterpartAnswer(
  text: string,
  named: NamedFileVersion,
  siteIndex: KbIndex | null,
): Promise<KbToolResult | undefined> {
  if (!siteIndex) return undefined;
  const found = siteIndex.search(askedFor(text, named), {
    topK: 1,
    onePerCard: true,
  });
  const [hit] = found.hits;
  if (found.status !== "ok" || !hit) return undefined;
  const shown = `${hit.card.title}\n${hit.chunk.text}`.toLowerCase();
  if (!shown.includes(bareName(named.counterpart))) return undefined;
  return kbToolResultOf({ ...found, hits: [hit] });
}

/** The answer with the file's line and the site's version's card for it, at the end. */
function withCounterpart(
  result: KbToolResult,
  named: NamedFileVersion,
  siteVersion: "4.x" | "5.x",
  extra: KbToolResult | undefined,
): KbToolResult {
  const added = (extra?.results ?? []).filter(
    (hit) =>
      !result.results.some(
        (shown) => shown.cite.split("#")[0] === hit.cite.split("#")[0],
      ),
  );
  return {
    ...result,
    cards: [...result.cards, ...(added.length > 0 ? (extra?.cards ?? []) : [])],
    results: [...result.results, ...added],
    fileVersion: {
      file: named.file,
      version: named.version,
      siteVersion,
      counterpart: named.counterpart,
      kind: named.kind,
    },
  };
}

const searchedPacks = (index: KbIndex): KbSearchedPack[] =>
  index.info.packs.map((pack) => ({
    version: pack.aptyVersion,
    sha256: packIdOf(pack.sha256),
    keyId: pack.keyId,
    expiresAt: pack.expiresAt,
  }));

/** The pack's best cards, a stub, the English-cards notice, or why there is no card. */
export async function localKbMatches(
  text: string,
  source: KbIndexSource = sharedKbIndexSource(),
  {
    modelAvailable = false,
    version: siteVersion = "unknown",
    delivery = sharedKbDeliveryNote(),
  }: KbMatchesOptions = {},
): Promise<KbOutcome> {
  if (isBareHowTo(text)) return { kind: "how_to" };
  const named = namedFileVersion(text.slice(0, MAX_QUERY_CHARS));
  let version = siteVersion;
  let index: Awaited<ReturnType<KbIndexSource["current"]>>;
  try {
    index = named ? await source.current(named.version) : null;
    if (index && named) version = named.version;
    else index = await source.current(siteVersion);
  } catch (error) {
    return failed("pack_read_failed", error);
  }
  const otherSite =
    named &&
    version === named.version &&
    siteVersion !== "unknown" &&
    siteVersion !== named.version
      ? siteVersion
      : undefined;
  if (!index) {
    let blocked: KbUnusablePack | undefined;
    try {
      blocked = unusablePackOf((await source.unusable?.(version)) ?? []);
    } catch (error) {
      return failed("pack_read_failed", error);
    }
    const missed = await delivery(blocked?.aptyVersion ?? version);
    const note = missed ? { delivery: missed } : {};
    return blocked
      ? {
          kind: "pack_unusable",
          reason: blocked.reason,
          version: blocked.aptyVersion,
          date: blocked.date,
          ...note,
        }
      : { kind: "no_pack", version, ...note };
  }
  const packs = searchedPacks(index);
  if (isMostlyNonLatin(text)) {
    return modelAvailable
      ? { kind: "non_english" }
      : {
          kind: "answer",
          result: { status: "non_english", ...kbSourceTag([]), results: [] },
          packs,
        };
  }
  try {
    const query = text.slice(0, MAX_QUERY_CHARS);
    const found = await measured(PERF.kbSearch, () =>
      index.search(query, { topK: KB_MATCHES, onePerCard: true }),
    );
    const result = kbToolResultOf(found);
    if (
      named &&
      otherSite &&
      result.status === "ok" &&
      result.results.length > 0 &&
      !result.choices
    ) {
      const siteIndex = await source.current(otherSite);
      const extra = await counterpartAnswer(query, named, siteIndex);
      const more = siteIndex ? searchedPacks(siteIndex) : [];
      return {
        kind: "answer",
        result: withCounterpart(result, named, otherSite, extra),
        packs: [
          ...packs,
          ...more.filter((p) => !packs.some((q) => q.sha256 === p.sha256)),
        ],
      };
    }
    if (
      result.status === "stub" ||
      result.status === "not_in_version" ||
      (result.status === "ok" && result.results.length > 0)
    ) {
      return { kind: "answer", result, packs };
    }
    if (found.reason === "unknown_setting") {
      return {
        kind: "unknown_setting",
        result,
        coverage: Math.round(found.coverage * 100) / 100,
        min: found.min ?? 0,
        ...(found.topPageId ? { topPageId: found.topPageId } : {}),
        version,
        packs,
      };
    }
    const closestPageIds = [
      ...new Set((found.closest ?? []).map((hit) => hit.chunk.pageId)),
    ];
    return {
      kind: "not_covered",
      reason: found.reason ?? "no_match",
      coverage: Math.round(found.coverage * 100) / 100,
      min: found.min ?? 0,
      ...(found.topPageId ? { topPageId: found.topPageId } : {}),
      ...(closestPageIds.length > 0 ? { closestPageIds } : {}),
      version,
      packs,
    };
  } catch (error) {
    return failed("search_failed", error);
  }
}

/** The outcome's answer, when it has one. */
export function kbAnswerOf(outcome: KbOutcome): KbToolResult | undefined {
  return outcome.kind === "answer" ? outcome.result : undefined;
}

const CITE_PAGE = /^kb:\/\/(\d+)/;

/**
 * The card ids the KB matches card shows for `result`, in its order (K27,
 * F7): the stub or the "not in this version" card first, then each result;
 * for a broad question (E3), the routing card's choices instead.
 * The decision record holds exactly these.
 * @internal exported for tests
 */
export function renderedPageIds(result: KbToolResult): string[] {
  if (result.choices) {
    return result.choices.options.map(
      (option) => CITE_PAGE.exec(option.cite)?.[1] ?? "",
    );
  }
  const cites = [
    result.status === "stub" ? result.stub?.cite : undefined,
    result.status === "not_in_version" ? result.absent?.cite : undefined,
    ...result.results.map((hit) => hit.cite),
  ];
  const ids: string[] = [];
  for (const cite of cites) {
    const id = cite ? CITE_PAGE.exec(cite)?.[1] : undefined;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The outcome as the decision record holds it: ids, numbers and codes only. */
export function kbDecisionOf(outcome: KbOutcome): KbDecision {
  switch (outcome.kind) {
    case "answer":
      return {
        kind: "answer",
        status: outcome.result.status,
        pageIds: renderedPageIds(outcome.result),
      };
    case "unknown_setting":
      return {
        kind: "not_covered",
        reason: "unknown_setting",
        coverage: outcome.coverage,
        min: outcome.min,
        ...(outcome.topPageId ? { topPageId: outcome.topPageId } : {}),
        version: outcome.version,
      };
    case "not_covered":
      return {
        kind: "not_covered",
        reason: outcome.reason,
        coverage: outcome.coverage,
        min: outcome.min,
        ...(outcome.topPageId ? { topPageId: outcome.topPageId } : {}),
        ...(outcome.closestPageIds
          ? { closestPageIds: outcome.closestPageIds }
          : {}),
        version: outcome.version,
      };
    case "error":
      return { kind: "error", code: outcome.code };
    default:
      return outcome;
  }
}
