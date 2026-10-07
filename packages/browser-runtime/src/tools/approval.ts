/**
 * Approval gate for high-risk tools (run_console_command,
 * upload_file_to_input today — extend to others per DECISIONS.md).
 *
 * No tool using this gate ever runs its real side effect on first call.
 * `gateRiskyAction` returns a structured "needs_approval" result instead of
 * invoking `run`; `run` only executes once the model calls
 * confirm_risky_action with the returned approvalId and the user's
 * explicit yes, obtained in the conversation itself. This is a
 * conversation-level gate (no new UI component), but it's a real,
 * code-enforced one: the model cannot skip it by re-describing the action
 * differently, since the exact closure shown to the user is the exact one
 * that runs.
 *
 * Per-origin grants: once the user approves an action on a given page
 * origin, that origin is remembered (persisted in chrome.storage.local) so
 * later risky calls on the SAME origin run immediately without re-asking —
 * matching the product's "debugs whatever page is open" nature (a fixed
 * allowlist was rejected for the same reason the `<all_urls>` host
 * permission was — see docs/security/PERMISSIONS.md).
 *
 * This replaces the previously-unwired, mode-based `HostAccessManager`
 * (apps/browser-extension/src/services/host-access.ts, zero callers before
 * this round) with a narrower, purpose-built mechanism: an origin is either
 * granted or not, no whitelist/blocklist mode to misconfigure. That old
 * file is left in place (still unused) rather than deleted in this round —
 * removing it is a separate, lower-priority cleanup.
 */
import { generateId, STORAGE_KEYS, tool } from "@apty/agent-core";
import { z } from "zod";
import { ChromeStorageAdapter } from "../storage/storage-adapter.js";
import type { ToolRunContext } from "./tab-utils.js";

const APPROVAL_TTL_MS = 5 * 60_000;

const storage = new ChromeStorageAdapter<string[]>();

interface PendingApproval {
  conversationId: string | undefined;
  toolName: string;
  summary: string;
  origin?: string;
  createdAt: number;
  run: () => Promise<unknown>;
}

const pending = new Map<string, PendingApproval>();

export interface ApprovalRequiredResult {
  status: "needs_approval";
  approvalId: string;
  toolName: string;
  summary: string;
  message: string;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

async function loadGrantedOrigins(): Promise<Set<string>> {
  const list = await storage.load(STORAGE_KEYS.RISKY_ORIGIN_GRANTS);
  return new Set(list ?? []);
}

async function grantOrigin(origin: string): Promise<void> {
  const granted = await loadGrantedOrigins();
  granted.add(origin);
  await storage.save(STORAGE_KEYS.RISKY_ORIGIN_GRANTS, [...granted]);
}

/**
 * Gate a risky action behind explicit user approval. If `pageUrl`'s origin
 * was already granted (a prior approval on this exact origin), `run`
 * executes immediately and its result is returned directly. Otherwise
 * returns an `ApprovalRequiredResult` — the caller (the tool's `execute`)
 * must return this AS ITS RESULT rather than performing the action.
 */
export async function gateRiskyAction<T>(
  conversationId: string | undefined,
  toolName: string,
  summary: string,
  pageUrl: string | undefined,
  run: () => Promise<T>,
): Promise<T | ApprovalRequiredResult> {
  const origin = originOf(pageUrl);
  if (origin) {
    const granted = await loadGrantedOrigins();
    if (granted.has(origin)) {
      return run();
    }
  }

  const approvalId = generateId();
  pending.set(approvalId, {
    conversationId,
    toolName,
    summary,
    origin: origin ?? undefined,
    createdAt: Date.now(),
    run: run as () => Promise<unknown>,
  });

  return {
    status: "needs_approval",
    approvalId,
    toolName,
    summary,
    message:
      `This action requires explicit user approval before it runs: ${summary} ` +
      "Show the user exactly what this will do and ask for a clear yes or no in plain language. " +
      "Only call confirm_risky_action with userConfirmed:true after the user has explicitly agreed in their own words in this conversation — never assume consent, never call it preemptively, and never rephrase the action to make it sound less risky than it is.",
  };
}

export interface ConfirmRiskyActionResult {
  found: boolean;
  executed?: boolean;
  denied?: boolean;
  result?: unknown;
  error?: string;
}

/** Resolve a pending approval. Scoped to the SAME conversation that created it — a different conversation can never confirm or discover another's pending action. */
export async function confirmRiskyAction(
  conversationId: string | undefined,
  approvalId: string,
  userConfirmed: boolean,
): Promise<ConfirmRiskyActionResult> {
  const entry = pending.get(approvalId);
  if (!entry) {
    return {
      found: false,
      error:
        "No pending approval with this id — it may already be resolved, expired, or never existed.",
    };
  }

  if (entry.conversationId !== conversationId) {
    // Don't delete someone else's pending entry just because a different
    // conversation guessed/collided on an id.
    return {
      found: false,
      error: "This approval belongs to a different conversation.",
    };
  }

  pending.delete(approvalId);

  if (Date.now() - entry.createdAt > APPROVAL_TTL_MS) {
    return {
      found: false,
      error:
        "This approval request expired. Ask the user again and request a new approval.",
    };
  }

  if (!userConfirmed) {
    return { found: true, denied: true, executed: false };
  }

  if (entry.origin) {
    await grantOrigin(entry.origin);
  }

  const result = await entry.run();
  return { found: true, executed: true, result };
}

/** Test/debug helper: how many approvals are currently pending. */
export function getPendingApprovalCount(): number {
  return pending.size;
}

/** Test-only helper: reset all in-memory and persisted approval state. */
export async function resetApprovalStateForTests(): Promise<void> {
  pending.clear();
  await storage.save(STORAGE_KEYS.RISKY_ORIGIN_GRANTS, []);
}

export const confirmRiskyActionTool = tool({
  name: "confirm_risky_action",
  description:
    "Resolve a pending risky-action approval (from run_console_command / upload_file_to_input) after the user has explicitly agreed or declined in the conversation. " +
    "Only call with userConfirmed:true after the user has given clear, explicit consent in their own words to the EXACT action described — never preemptively, never on assumed consent, and never if the user's reply was ambiguous (ask them to clarify instead). " +
    "The approved action then runs immediately and its real result is returned here.",
  parameters: z.object({
    approvalId: z
      .string()
      .min(1)
      .describe(
        "The approvalId from the tool call that returned needs_approval.",
      ),
    userConfirmed: z
      .boolean()
      .describe(
        "true only if the user explicitly agreed to this exact action; false if they declined.",
      ),
  }),
  execute: async ({ approvalId, userConfirmed }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    return confirmRiskyAction(conversationId, approvalId, userConfirmed);
  },
});
