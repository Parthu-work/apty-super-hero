/**
 * Reads the organization policy (KB-RAG K22, S1) from Chrome's managed
 * storage, where IT deploys it, and keeps the last state in memory so a
 * synchronous check can use it. Until the first read completes the state
 * is invalid ("not read yet"): fail closed.
 *
 * The source is `chrome.storage.managed`. Only an E2E build replaces it
 * (`apps/browser-extension/src/services/org-policy.ts`), because Playwright
 * cannot set managed storage.
 */
import { type OrgPolicyState, orgPolicyStateOf } from "@apty/agent-core";

/** Where the raw policy object comes from, and how its changes are heard. */
export interface OrgPolicySource {
  read(): Promise<unknown>;
  watch(onChange: () => void): () => void;
}

const NOT_READ: OrgPolicyState = {
  kind: "invalid",
  reason: "the policy has not been read yet",
};

const managedSource: OrgPolicySource = {
  async read() {
    const managed =
      typeof chrome !== "undefined" ? chrome.storage?.managed : undefined;
    if (!managed) return {};
    return managed.get(null);
  },
  watch(onChange) {
    const onChanged =
      typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
    if (!onChanged) return () => {};
    const listener = (_: unknown, area: string) => {
      if (area === "managed") onChange();
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  },
};

let source: OrgPolicySource = managedSource;
let cached: OrgPolicyState | null = null;
let loading: Promise<OrgPolicyState> | null = null;
let stopWatching: (() => void) | null = null;
const listeners = new Set<(state: OrgPolicyState) => void>();

/** @internal Replaces the managed-storage source: E2E builds and tests only. */
export function setOrgPolicySource(next: OrgPolicySource): void {
  stopWatching?.();
  stopWatching = null;
  source = next;
  cached = null;
  loading = null;
}

async function readState(): Promise<OrgPolicyState> {
  try {
    return orgPolicyStateOf(await source.read());
  } catch (error) {
    return {
      kind: "invalid",
      reason: `the policy could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function ensureWatching(): void {
  if (stopWatching) return;
  stopWatching = source.watch(() => {
    loading = null;
    void readState().then((state) => {
      cached = state;
      for (const listener of listeners) listener(state);
    });
  });
}

/** The policy state, read on first use and kept current after. */
export function loadOrgPolicy(): Promise<OrgPolicyState> {
  ensureWatching();
  if (cached) return Promise.resolve(cached);
  loading ??= readState().then((state) => {
    cached ??= state;
    loading = null;
    return cached;
  });
  return loading;
}

/**
 * The last state read, or invalid while the first read is pending (which this starts).
 * @internal
 */
export function currentOrgPolicy(): OrgPolicyState {
  return peekOrgPolicy() ?? NOT_READ;
}

/**
 * The last state read, or undefined while the first read is pending (which
 * this starts): for a check that can wait for the request itself, where
 * `loadOrgPolicy()` decides.
 */
export function peekOrgPolicy(): OrgPolicyState | undefined {
  if (!cached) void loadOrgPolicy();
  return cached ?? undefined;
}

/** Calls `onChange` with each new state; returns the unsubscribe. */
export function watchOrgPolicy(
  onChange: (state: OrgPolicyState) => void,
): () => void {
  ensureWatching();
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** @internal */
export function resetOrgPolicyForTests(): void {
  setOrgPolicySource(managedSource);
  listeners.clear();
}
