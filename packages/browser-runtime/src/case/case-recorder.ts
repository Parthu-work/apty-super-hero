/**
 * Records each conversation's case (KB-RAG K25, L1): wraps the chat's
 * local responder, so every turn's decision, check and KB answer lands in
 * the case, and takes the checks and KB searches the model runs too. Ids,
 * numbers, codes and the SE's own Strict-redacted symptom only (D-CASE1).
 */
import {
  CASE_DOM_CONFIG_FILE_MAX,
  type CaseCheck,
  type CaseDomConfig,
  type CaseFinding,
  type CaseOutcome,
  type CaseRecord,
  type CaseTurn,
  closeCase,
  isLocalAnswer,
  type LocalAnswer,
  type LocalDecision,
  type LocalResponder,
  newCase,
  turnStartsCase,
  withTurn,
} from "@apty/agent-core";
import type { DiagnosisResult } from "../apty/diagnosis/types.js";
import { siteHostOf } from "../conversation/site-host.js";
import type { KbToolResult } from "../kb/kb-index.js";
import { hasSymptomWord } from "../kb/kb-intent.js";
import { redactTextStrict } from "../runtime/redaction-mode.js";
import { type CaseStore, createCaseStore } from "../storage/case-store.js";

const RUN_DIAGNOSIS = "run_diagnosis";
const SEARCH_KB = "search_kb";

const PARAM_FIELDS = {
  mode: ["mode", "clientMode"],
  environment: ["environment", "environmentName", "env"],
  clientVersion: ["clientVersion", "playerVersion", "version"],
} as const;

/** The first value of one of `keys` in the check's gate and cause params. */
function paramOf(
  result: DiagnosisResult,
  keys: readonly string[],
): string | undefined {
  for (const params of [
    ...result.verdict.causes.map((c) => c.params),
    ...result.gates.map((g) => g.params),
  ]) {
    for (const key of keys) {
      const value = params?.[key];
      if (typeof value === "string" || typeof value === "number") {
        return String(value).slice(0, 60);
      }
    }
  }
  return undefined;
}

function isDiagnosis(value: unknown): value is DiagnosisResult {
  const result = value as Partial<DiagnosisResult> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    typeof result.packId === "string" &&
    typeof result.verdict === "object"
  );
}

function isKbResult(value: unknown): value is KbToolResult {
  const result = value as Partial<KbToolResult> | null;
  return (
    typeof result === "object" &&
    result !== null &&
    result.source === "kb" &&
    Array.isArray(result.cards)
  );
}

/** What a check's result adds to the case: the pack, status, rules and the finding. */
function caseCheckOf(
  result: DiagnosisResult,
  at: string,
): NonNullable<CaseTurn["check"]> {
  const [first] = result.verdict.causes;
  const failedGate = result.gates.find((gate) => gate.status === "fail");
  const finding: CaseFinding | undefined = first
    ? {
        ruleId: first.ruleId,
        ...(failedGate ? { cause: String(failedGate.reason) } : {}),
        cardPageId: first.cardPageId,
        confidence: result.confidence,
        verification:
          result.confidence === "unknown"
            ? "NOT VERIFIED"
            : "from code, not runtime-verified",
      }
    : undefined;
  const check: CaseCheck = {
    packId: result.packId,
    at,
    status: result.verdict.status,
    ruleIds: result.verdict.causes.map((cause) => cause.ruleId),
  };
  const mode = paramOf(result, PARAM_FIELDS.mode);
  const environment = paramOf(result, PARAM_FIELDS.environment);
  const clientVersion = paramOf(result, PARAM_FIELDS.clientVersion);
  return {
    ...check,
    ...(finding ? { finding } : {}),
    ...(mode ? { mode } : {}),
    ...(environment ? { environment } : {}),
    ...(clientVersion ? { clientVersion } : {}),
  };
}

/** What a KB result adds: the card ids and layers shown, never their text. */
function caseKbOf(
  result: KbToolResult,
  packs: Array<{ version: string; sha256: string }> = [],
): NonNullable<CaseTurn["kb"]> {
  return {
    cards: result.cards.map((card) => ({
      pageId: card.pageId,
      ...(card.layer !== undefined ? { layer: card.layer } : {}),
    })),
    status: result.status,
    packs,
  };
}

type Listener = () => void;

export interface CaseRecorder {
  /** Wraps the chat's responder so each turn is recorded. */
  wrap(responder: LocalResponder): LocalResponder;
  /** A check or KB search the model ran in the conversation. */
  recordToolResult(
    conversationId: string,
    toolName: string,
    result: unknown,
  ): Promise<void>;
  current(conversationId: string): Promise<CaseRecord | undefined>;
  /**
   * K26 (C4): a DOM Config run held, or its settings exported, while the
   * conversation's case is open. A field left out keeps its value for the
   * same run. No open case: nothing is recorded.
   */
  recordDomConfig(conversationId: string, entry: CaseDomConfig): Promise<void>;
  close(
    conversationId: string,
    outcome: Exclude<CaseOutcome, "open">,
    answers?: Pick<CaseRecord, "findingRight" | "rightCardId" | "note">,
  ): Promise<CaseRecord | undefined>;
  /** Moves a case to this conversation ("Continue CASE-…"). */
  continueIn(caseId: string, conversationId: string): Promise<void>;
  /** Continues `caseId` in the conversation of the next recorded turn: for a chat with no message yet. */
  continueOnNextTurn(caseId: string): void;
  subscribe(listener: Listener): () => void;
  store: CaseStore;
}

/** The conversation id of a run context, as the chat binds one. */
function conversationOf(
  runContext: unknown,
  sessionId: string | undefined,
): string | undefined {
  const id = (runContext as { conversationId?: unknown } | undefined)
    ?.conversationId;
  if (typeof id === "string" && id && id !== "pending") return id;
  return sessionId;
}

export function createCaseRecorder({
  store = createCaseStore(),
  now = () => new Date(),
  tabUrlOf = async () => undefined,
  random,
}: {
  store?: CaseStore;
  now?: () => Date;
  tabUrlOf?: (runContext: unknown) => Promise<string | undefined>;
  random?: () => number;
} = {}): CaseRecorder {
  const listeners = new Set<Listener>();
  let pendingContinue: string | undefined;
  const recorded = new WeakSet<object>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  /** Adds `turn` to the conversation's case, opening one when the turn starts a case. */
  async function apply(
    conversationId: string,
    turn: CaseTurn,
    starts: boolean,
    tabHost?: string,
  ) {
    const existing = await store.forConversation(conversationId);
    const open = existing?.outcome === "open" ? existing : undefined;
    if (!open && !starts) return undefined;
    const base =
      open ??
      newCase(conversationId, now(), {
        ...(tabHost ? { tabHost } : {}),
        ...(random ? { random } : {}),
      });
    const next = withTurn(base, turn);
    await store.put(next);
    notify();
    return next;
  }

  async function recordAnswer(
    conversationId: string,
    input: string,
    tabUrl: string | undefined,
    answer: LocalAnswer | LocalDecision | undefined,
  ) {
    const at = now().toISOString();
    const decision = answer?.decision;
    const symptom = hasSymptomWord(input);
    const turn: CaseTurn = {
      at,
      ...(decision ? { decision } : {}),
      ...(symptom || decision?.route === "check"
        ? { symptom: redactTextStrict(input).slice(0, 300) }
        : {}),
    };
    if (isLocalAnswer(answer)) {
      if (typeof answer.result === "object" && answer.result !== null) {
        recorded.add(answer.result);
      }
      if (answer.toolName === RUN_DIAGNOSIS && isDiagnosis(answer.result)) {
        turn.check = caseCheckOf(answer.result, at);
      }
      if (answer.toolName === SEARCH_KB && isKbResult(answer.result)) {
        turn.kb = caseKbOf(
          answer.result,
          (decision?.packs ?? []).map(({ version, sha256 }) => ({
            version,
            sha256,
          })),
        );
      }
    }
    const tabHost = siteHostOf(tabUrl);
    return apply(
      conversationId,
      turn,
      turnStartsCase(decision, symptom),
      tabHost,
    );
  }

  return {
    store,
    wrap(responder) {
      return async (input, context) => {
        const answer = await responder(input, context);
        const conversationId = conversationOf(
          context.runContext,
          context.sessionId,
        );
        if (conversationId) {
          try {
            if (pendingContinue) {
              const caseId = pendingContinue;
              pendingContinue = undefined;
              await this.continueIn(caseId, conversationId);
            }
            await recordAnswer(
              conversationId,
              input,
              await tabUrlOf(context.runContext),
              answer,
            );
          } catch (error) {
            console.error("[case] the turn could not be recorded", error);
          }
        }
        return answer;
      };
    },
    async recordToolResult(conversationId, toolName, result) {
      if (typeof result === "object" && result !== null) {
        if (recorded.has(result)) return;
        recorded.add(result);
      }
      const at = now().toISOString();
      if (toolName === RUN_DIAGNOSIS && isDiagnosis(result)) {
        await apply(
          conversationId,
          { at, check: caseCheckOf(result, at) },
          true,
        );
      } else if (toolName === SEARCH_KB && isKbResult(result)) {
        const kb = caseKbOf(result);
        await apply(conversationId, { at, kb }, kb.cards.length > 0);
      }
    },
    current: (conversationId) => store.forConversation(conversationId),
    async recordDomConfig(conversationId, entry) {
      const open = await store.forConversation(conversationId);
      if (!open || open.outcome !== "open") return;
      const same = open.domConfig?.runId === entry.runId;
      const settingsFile =
        entry.settingsFile &&
        new TextEncoder().encode(entry.settingsFile).length <=
          CASE_DOM_CONFIG_FILE_MAX
          ? entry.settingsFile
          : undefined;
      const domConfig: CaseDomConfig = {
        ...(same ? open.domConfig : {}),
        ...entry,
        ...(settingsFile ? { settingsFile } : {}),
      };
      if (!settingsFile && !same) delete domConfig.settingsFile;
      await store.put({
        ...open,
        updatedAt: now().toISOString(),
        domConfig,
      });
      notify();
    },
    async close(conversationId, outcome, answers) {
      const open = await store.forConversation(conversationId);
      if (!open || open.outcome !== "open") return undefined;
      const closed = closeCase(open, outcome, now(), answers);
      await store.put(closed);
      notify();
      return closed;
    },
    async continueIn(caseId, conversationId) {
      const record = await store.get(caseId);
      if (!record) return;
      await store.put({
        ...record,
        conversationId,
        updatedAt: now().toISOString(),
      });
      notify();
    },
    continueOnNextTurn(caseId) {
      pendingContinue = caseId;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
