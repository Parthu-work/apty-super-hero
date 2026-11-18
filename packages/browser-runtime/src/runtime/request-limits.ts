/**
 * The request budget and the answer cap from Settings, read once and kept
 * current through storage change events, the way the redaction mode is, so
 * a change applies to the next request without rebuilding the agent.
 */
import {
  type AppSettings,
  DEFAULT_PROVIDER_REQUEST_CAP,
  MAX_OUTPUT_TOKENS_RANGE,
  providerRequestCap,
  REQUEST_TOKEN_BUDGET_RANGE,
  STORAGE_KEYS,
} from "@apty/agent-core";
import { loadSettings, watchEffectiveSettings } from "./effective-settings.js";

export interface RequestLimits {
  requestTokenBudget?: number;
  maxOutputTokens?: number;
  summarizeEarlierTurns?: boolean;
}

/** Summaries start below the budget, so the next request fits without leaving turns out. */
const SUMMARY_SHARE_OF_BUDGET = 0.75;
/** Without a budget, a chat is summarized once a request reaches this many tokens. */
const SUMMARY_WATERMARK_WITHOUT_BUDGET = 20_000;

function within(
  value: unknown,
  range: { min: number; max: number },
): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
    ? value
    : undefined;
}

/** @internal */
export function limitsFromSettings(settings: unknown): RequestLimits {
  const s = settings as AppSettings | undefined;
  const requestTokenBudget = within(
    s?.requestTokenBudget,
    REQUEST_TOKEN_BUDGET_RANGE,
  );
  const maxOutputTokens = within(s?.maxOutputTokens, MAX_OUTPUT_TOKENS_RANGE);
  return {
    ...(requestTokenBudget ? { requestTokenBudget } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(s?.summarizeEarlierTurns === true
      ? { summarizeEarlierTurns: true }
      : {}),
  };
}

/**
 * The request size, in estimated tokens, above which the earlier turns are
 * summarized, or undefined while summaries are off.
 *
 * @internal
 */
export function summaryWatermarkFor(limits: RequestLimits): number | undefined {
  if (!limits.summarizeEarlierTurns) return undefined;
  return limits.requestTokenBudget
    ? Math.floor(limits.requestTokenBudget * SUMMARY_SHARE_OF_BUDGET)
    : SUMMARY_WATERMARK_WITHOUT_BUDGET;
}

let cached: RequestLimits | null = null;
let cachedProviderCap = DEFAULT_PROVIDER_REQUEST_CAP;
let loading: Promise<RequestLimits> | null = null;
let listening = false;

function remember(settings: unknown): RequestLimits {
  cachedProviderCap = providerRequestCap((settings ?? {}) as AppSettings);
  return limitsFromSettings(settings);
}

function listenForChanges(): void {
  if (listening || typeof chrome === "undefined") return;
  const onChanged = chrome.storage?.onChanged;
  if (!onChanged) return;
  listening = true;
  watchEffectiveSettings(({ settings }) => {
    cached = remember(settings);
  });
}

/** The current limits, read from settings on first use and cached after. */
export function getRequestLimits(): Promise<RequestLimits> {
  listenForChanges();
  if (cached !== null) return Promise.resolve(cached);
  loading ??= (async () => {
    try {
      const settings = await loadSettings();
      // A change event that arrived while reading is newer than the read.
      cached ??= remember(settings);
    } catch {
      cached ??= {};
    }
    loading = null;
    return cached;
  })();
  return loading;
}

/**
 * The budget every request is kept under (KB-RAG K27, E6): the one Settings
 * sets, else the chat provider's cap, so a long chat stays inside the
 * provider's context window with no setting.
 */
export async function getRequestBudget(): Promise<number> {
  return (await getRequestLimits()).requestTokenBudget ?? cachedProviderCap;
}

/**
 * `summaryWatermarkFor` the limits read so far, without waiting: every turn
 * reads the limits before it ends, so they are loaded by the time a chat is
 * saved. Off until then.
 */
export function currentSummaryWatermark(): number | undefined {
  if (cached === null) {
    void getRequestLimits();
    return undefined;
  }
  return summaryWatermarkFor(cached);
}

/** @internal */
export function resetRequestLimitsForTests(): void {
  cached = null;
  cachedProviderCap = DEFAULT_PROVIDER_REQUEST_CAP;
  loading = null;
  listening = false;
}
