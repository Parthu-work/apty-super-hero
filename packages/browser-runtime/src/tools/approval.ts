/**
 * Human approval gate for high-risk tools (run_console_command, fill_*,
 * computer type/key, upload_file_to_input, downloads).
 *
 * The gated tool call is suspended until a person clicks Allow or Deny in the
 * extension UI. The decision travels UI -> `resolveApproval` and never passes
 * through the model: there is no model-callable confirmation tool, so a
 * prompt-injected page cannot approve its own action.
 *
 * Contexts: tools run either in the side panel (agent) or the service worker
 * (MCP bridge). The side panel renders the request; when the tool runs in the
 * service worker the request and decision are relayed with runtime messages,
 * which are only accepted from this extension's own pages. With no UI
 * able to show the request the call fails closed.
 *
 * Grants are optional ("allow on this site for a while") and scoped to one
 * tool on one origin with an expiry, listable and revocable.
 */
import { generateId, STORAGE_KEYS } from "@apty/agent-core";
import { isOwnExtensionPage } from "../runtime/trusted-sender.js";
import { ChromeStorageAdapter } from "../storage/storage-adapter.js";

export const APPROVAL_TTL_MS = 5 * 60_000;
/**
 * A request from outside a chat (an MCP client) expires before the MCP
 * bridge's 60 s tool timeout, so the caller hears the real outcome and an
 * Allow can never run an action the caller was already told had failed.
 */
export const MCP_APPROVAL_TTL_MS = 50_000;
export const GRANT_TTL_MS = 15 * 60_000;

export const APPROVAL_REQUEST_MESSAGE = "apty-approval-request";
export const APPROVAL_DECISION_MESSAGE = "apty-approval-decision";
export const APPROVAL_CLOSED_MESSAGE = "apty-approval-closed";

export interface ApprovalRequest {
  approvalId: string;
  conversationId?: string;
  toolName: string;
  summary: string;
  origin?: string;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalDecision {
  approved: boolean;
  /** Skip the prompt for this tool on this origin until the grant expires. */
  remember?: boolean;
}

export type ApprovalDeniedReason = "user_denied" | "expired" | "no_approval_ui";

export interface ApprovalDeniedResult {
  status: "denied";
  toolName: string;
  reason: ApprovalDeniedReason;
  message: string;
}

export interface ApprovalGrant {
  toolName: string;
  origin: string;
  expiresAt: number;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ApprovalOutcome =
  | { status: "approved"; remember: boolean }
  | { status: "denied"; reason: ApprovalDeniedReason };

const pending = new Map<string, PendingApproval>();
const listeners = new Set<(requests: ApprovalRequest[]) => void>();
const storage = new ChromeStorageAdapter<ApprovalGrant[]>();

let decisionListenerInstalled = false;

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function isGrant(value: unknown): value is ApprovalGrant {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.toolName === "string" &&
    typeof v.origin === "string" &&
    typeof v.expiresAt === "number"
  );
}

async function loadActiveGrants(now = Date.now()): Promise<ApprovalGrant[]> {
  const stored = await storage.load(STORAGE_KEYS.RISKY_ORIGIN_GRANTS);
  if (!Array.isArray(stored)) return [];
  return stored.filter((g) => isGrant(g) && g.expiresAt > now);
}

export function listApprovalGrants(): Promise<ApprovalGrant[]> {
  return loadActiveGrants();
}

async function addGrant(toolName: string, origin: string): Promise<void> {
  const grants = (await loadActiveGrants()).filter(
    (g) => !(g.toolName === toolName && g.origin === origin),
  );
  grants.push({ toolName, origin, expiresAt: Date.now() + GRANT_TTL_MS });
  await storage.save(STORAGE_KEYS.RISKY_ORIGIN_GRANTS, grants);
}

export async function revokeApprovalGrant(
  toolName: string,
  origin: string,
): Promise<void> {
  const grants = (await loadActiveGrants()).filter(
    (g) => !(g.toolName === toolName && g.origin === origin),
  );
  await storage.save(STORAGE_KEYS.RISKY_ORIGIN_GRANTS, grants);
}

export async function revokeAllApprovalGrants(): Promise<void> {
  await storage.save(STORAGE_KEYS.RISKY_ORIGIN_GRANTS, []);
}

function emitChange(): void {
  const snapshot = getPendingApprovals();
  for (const listener of listeners) listener(snapshot);
}

export function getPendingApprovals(): ApprovalRequest[] {
  return [...pending.values()].map((p) => p.request);
}

/** Subscribe to the set of pending requests (used by the approval dialog). */
export function subscribeApprovalRequests(
  listener: (requests: ApprovalRequest[]) => void,
): () => void {
  listeners.add(listener);
  listener(getPendingApprovals());
  return () => {
    listeners.delete(listener);
  };
}

function broadcast(message: Record<string, unknown>): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return Promise.resolve(false);
  }
  try {
    return chrome.runtime.sendMessage(message).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

function settle(approvalId: string, outcome: ApprovalOutcome): boolean {
  const entry = pending.get(approvalId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(approvalId);
  entry.resolve(outcome);
  emitChange();
  void broadcast({ type: APPROVAL_CLOSED_MESSAGE, approvalId });
  return true;
}

/**
 * Apply a person's decision. Called by the approval UI; returns false when the
 * request is unknown or already resolved.
 */
export function resolveApproval(
  approvalId: string,
  decision: ApprovalDecision,
): boolean {
  return settle(
    approvalId,
    decision.approved
      ? { status: "approved", remember: decision.remember === true }
      : { status: "denied", reason: "user_denied" },
  );
}

function installDecisionListener(): void {
  if (decisionListenerInstalled) return;
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
  decisionListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== APPROVAL_DECISION_MESSAGE) return false;
    if (!isOwnExtensionPage(sender)) return false;
    if (typeof message.approvalId !== "string") return false;
    resolveApproval(message.approvalId, {
      approved: message.approved === true,
      remember: message.remember === true,
    });
    return false;
  });
}

async function requestHumanApproval(
  request: ApprovalRequest,
): Promise<ApprovalOutcome> {
  installDecisionListener();

  const outcome = new Promise<ApprovalOutcome>((resolve) => {
    const timer = setTimeout(
      () => settle(request.approvalId, { status: "denied", reason: "expired" }),
      request.expiresAt - request.createdAt,
    );
    pending.set(request.approvalId, { request, resolve, timer });
  });
  emitChange();

  const relayed = await broadcast({
    type: APPROVAL_REQUEST_MESSAGE,
    request,
  });
  if (!relayed && listeners.size === 0) {
    settle(request.approvalId, { status: "denied", reason: "no_approval_ui" });
  }
  return outcome;
}

const DENIAL_MESSAGES: Record<ApprovalDeniedReason, string> = {
  user_denied: "The user denied this action. Do not retry it.",
  expired:
    "The approval request expired without an answer. Do not retry unless the user asks again.",
  no_approval_ui:
    "No approval prompt could be shown. Ask the user to open the extension side panel and try again.",
};

/**
 * Gate a risky action behind a human click. Resolves with `run`'s result once
 * approved (or when an unexpired grant for this tool and origin exists) and
 * with an `ApprovalDeniedResult` otherwise.
 */
export async function gateRiskyAction<T>(
  conversationId: string | undefined,
  toolName: string,
  summary: string,
  pageUrl: string | undefined,
  run: () => Promise<T>,
): Promise<T | ApprovalDeniedResult> {
  const origin = originOf(pageUrl);
  if (origin) {
    const grants = await loadActiveGrants();
    if (grants.some((g) => g.toolName === toolName && g.origin === origin)) {
      return run();
    }
  }

  const createdAt = Date.now();
  const outcome = await requestHumanApproval({
    approvalId: generateId(),
    conversationId,
    toolName,
    summary,
    origin: origin ?? undefined,
    createdAt,
    expiresAt:
      createdAt + (conversationId ? APPROVAL_TTL_MS : MCP_APPROVAL_TTL_MS),
  });

  if (outcome.status === "denied") {
    return {
      status: "denied",
      toolName,
      reason: outcome.reason,
      message: DENIAL_MESSAGES[outcome.reason],
    };
  }

  if (outcome.remember && origin) {
    await addGrant(toolName, origin);
  }
  return run();
}

/** Test-only helper: drop pending requests and persisted grants. */
export async function resetApprovalStateForTests(): Promise<void> {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  listeners.clear();
  await storage.save(STORAGE_KEYS.RISKY_ORIGIN_GRANTS, []);
}
