/**
 * KB text off by default (KB-RAG K22, S4, D-SEC1): decided once per request
 * from the policy, the request's destination and the loaded packs, and
 * enforced in the outbound filter that runs first on every request,
 * including the summary request (`onSummarySource`).
 */
import {
  type AiDestination,
  type AppSettings,
  destinationOf,
  type KbCardRef,
  type KbEgressDecision,
  type KbPackInfo,
  kbCardsIn,
  kbEgressAllowed,
  type OrgPolicyState,
  type OutboundFilter,
  summaryModelFor,
  withholdKbText,
} from "@apty/agent-core";
import {
  type EffectiveSettingsDeps,
  loadEffectiveSettings,
  loadKbPackInfos,
} from "./effective-settings.js";

export type KbEgressPurpose = "chat" | "summary";

export interface KbEgressState {
  decision: KbEgressDecision;
  destination?: AiDestination;
  packs: KbPackInfo[];
  policy?: OrgPolicyState;
}

/** The settings a request of `purpose` is made with: the summary request has its own model. */
function settingsFor(
  settings: AppSettings,
  purpose: KbEgressPurpose,
): AppSettings {
  if (purpose !== "summary") return settings;
  const model = summaryModelFor({ ...settings, summarizeEarlierTurns: true });
  return model ? { ...settings, aiModel: model } : settings;
}

/** Whether KB text may go with the next request of `purpose`; withheld when anything cannot be read. */
export async function decideKbEgress(
  purpose: KbEgressPurpose = "chat",
  deps?: EffectiveSettingsDeps,
): Promise<KbEgressState> {
  try {
    const [effective, packs] = await Promise.all([
      loadEffectiveSettings(deps),
      loadKbPackInfos(deps),
    ]);
    const destination = destinationOf(settingsFor(effective.settings, purpose));
    return {
      decision: kbEgressAllowed(effective.policy, destination, packs),
      destination,
      packs,
      policy: effective.policy,
    };
  } catch {
    return {
      decision: { allowed: false, reason: "check-failed" },
      packs: [],
    };
  }
}

export interface KbEgressFilterOptions {
  decide?: (purpose: KbEgressPurpose) => Promise<KbEgressState>;
  /** A request is leaving with KB text (S7 records it). */
  onSent?: (
    sent: { cards: KbCardRef[]; purpose: KbEgressPurpose } & KbEgressState,
  ) => void | Promise<void>;
}

/**
 * The first outbound filter: when the decision withholds KB text, every
 * tagged KB result's text becomes "KB card text withheld by organization
 * policy. Cards shown to the user: <ids>." before the sanitizer runs.
 */
export function createKbEgressFilter(
  options: KbEgressFilterOptions = {},
): OutboundFilter {
  const decide = options.decide ?? decideKbEgress;
  const filter = async (
    items: Parameters<OutboundFilter>[0],
    request: Parameters<OutboundFilter>[1],
  ) => {
    const cards = kbCardsIn(items);
    if (cards.length === 0) return items;
    const purpose: KbEgressPurpose =
      request.purpose === "summary" ? "summary" : "chat";
    let state: KbEgressState;
    try {
      state = await decide(purpose);
    } catch {
      return withholdKbText(items);
    }
    if (!state.decision.allowed) return withholdKbText(items);
    try {
      await options.onSent?.({ ...state, cards, purpose });
    } catch {
      // A send that cannot be recorded does not carry KB text (D-SEC6).
      return withholdKbText(items);
    }
    return items;
  };
  return Object.assign(filter, { onSummarySource: true as const });
}
