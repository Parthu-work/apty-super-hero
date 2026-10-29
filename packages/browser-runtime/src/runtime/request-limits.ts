/**
 * The request budget and the answer cap from Settings, read once and kept
 * current through storage change events, the way the redaction mode is, so
 * a change applies to the next request without rebuilding the agent.
 */
import {
  type AppSettings,
  MAX_OUTPUT_TOKENS_RANGE,
  REQUEST_TOKEN_BUDGET_RANGE,
  STORAGE_KEYS,
} from "@apty/agent-core";

export interface RequestLimits {
  requestTokenBudget?: number;
  maxOutputTokens?: number;
}

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
  };
}

let cached: RequestLimits | null = null;
let loading: Promise<RequestLimits> | null = null;
let listening = false;

function listenForChanges(): void {
  if (listening || typeof chrome === "undefined") return;
  const onChanged = chrome.storage?.onChanged;
  if (!onChanged) return;
  listening = true;
  onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[STORAGE_KEYS.SETTINGS];
    if (change) cached = limitsFromSettings(change.newValue);
  });
}

/** The current limits, read from settings on first use and cached after. */
export function getRequestLimits(): Promise<RequestLimits> {
  listenForChanges();
  if (cached !== null) return Promise.resolve(cached);
  loading ??= (async () => {
    try {
      const area =
        typeof chrome !== "undefined" ? chrome.storage?.local : undefined;
      const stored = area ? await area.get(STORAGE_KEYS.SETTINGS) : undefined;
      // A change event that arrived while reading is newer than the read.
      cached ??= limitsFromSettings(stored?.[STORAGE_KEYS.SETTINGS]);
    } catch {
      cached ??= {};
    }
    loading = null;
    return cached;
  })();
  return loading;
}

/** @internal */
export function resetRequestLimitsForTests(): void {
  cached = null;
  loading = null;
  listening = false;
}
