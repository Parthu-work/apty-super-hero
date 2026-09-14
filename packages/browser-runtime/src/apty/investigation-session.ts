/**
 * Investigation session lifecycle.
 *
 * The evidence store (`evidence-store.ts`) and correlation engine
 * (`evidence-correlation.ts`) answer "what has been observed so far in this
 * conversation" — they have no concept of "what is the agent's current
 * hypothesis" or "has this investigation been resolved". This module adds
 * that first-class lifecycle state on top of the existing evidence layer,
 * without duplicating it: an `InvestigationSession` never stores evidence
 * itself, only a reference to the conversation whose evidence belongs to it.
 *
 * Deliberately `Map<conversationId, InvestigationSession>`, mirroring
 * `evidence-store.ts`'s per-conversation isolation — one investigation per
 * conversation, never leaking into another's.
 */
import { generateId } from "@aipexstudio/aipex-core";
import type { DiagnosisConfidence } from "./types.js";

/**
 * Lifecycle states a UI can render directly. `starting`/`investigating`/
 * `collecting_evidence`/`analyzing`/`verifying` are all "in progress" states
 * the agent moves through via `updateInvestigation()`; `resolved`/`failed`/
 * `stopped` are terminal.
 */
export type InvestigationStatus =
  | "starting"
  | "investigating"
  | "collecting_evidence"
  | "analyzing"
  | "verifying"
  | "resolved"
  | "failed"
  | "stopped";

/** The Apty components an investigation can be scoped to. */
export type AptyComponentKind =
  | "apty-client"
  | "apty-widget"
  | "apty-studio"
  | "service-worker";

export interface VerificationAttempt {
  id: string;
  timestamp: number;
  outcome: "confirmed" | "not_confirmed" | "inconclusive";
  notes?: string;
}

export interface InvestigationSession {
  id: string;
  conversationId: string;
  tabId: number | null;
  startedAt: number;
  updatedAt: number;
  status: InvestigationStatus;
  /** The problem as the user described it, verbatim or lightly summarized. */
  userProblem: string;
  suspectedComponents: AptyComponentKind[];
  hypotheses: string[];
  verificationAttempts: VerificationAttempt[];
  diagnosis?: string;
  confidence?: DiagnosisConfidence;
}

export interface StartInvestigationInput {
  conversationId: string;
  tabId: number | null;
  userProblem: string;
  suspectedComponents?: AptyComponentKind[];
}

export interface UpdateInvestigationInput {
  status?: InvestigationStatus;
  addHypothesis?: string;
  addSuspectedComponent?: AptyComponentKind;
  diagnosis?: string;
  confidence?: DiagnosisConfidence;
}

/** Mirrors `evidence-store.ts`'s convention: a conversation id isn't real until a session exists, so `"pending"`/`undefined` all bucket together. */
const UNSCOPED_KEY = "__unscoped__";

function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

const investigationsByConversation = new Map<string, InvestigationSession>();

/**
 * Start a new investigation for a conversation, replacing any previous one
 * for the same conversation (starting a fresh investigation supersedes the
 * old lifecycle state, the same way `clear_investigation_evidence` discards
 * old evidence — the two are deliberately independent calls, since a fresh
 * investigation may still want to reference prior evidence).
 */
export function startInvestigation(
  input: StartInvestigationInput,
): InvestigationSession {
  const now = Date.now();
  const session: InvestigationSession = {
    id: generateId(),
    conversationId: input.conversationId,
    tabId: input.tabId,
    startedAt: now,
    updatedAt: now,
    status: "starting",
    userProblem: input.userProblem,
    suspectedComponents: input.suspectedComponents ?? [],
    hypotheses: [],
    verificationAttempts: [],
  };
  investigationsByConversation.set(keyFor(input.conversationId), session);
  return session;
}

/** The current investigation for a conversation, or `undefined` if none has been started (or it was cleared/superseded). */
export function getInvestigation(
  conversationId: string | undefined,
): InvestigationSession | undefined {
  const session = investigationsByConversation.get(keyFor(conversationId));
  return session ? { ...session } : undefined;
}

/**
 * Apply a partial update to the conversation's current investigation.
 * Returns `undefined` (no-op) when no investigation has been started yet —
 * callers should tell the model to call `start_investigation` first rather
 * than silently creating one, so the lifecycle stays explicit.
 */
export function updateInvestigation(
  conversationId: string | undefined,
  patch: UpdateInvestigationInput,
): InvestigationSession | undefined {
  const key = keyFor(conversationId);
  const existing = investigationsByConversation.get(key);
  if (!existing) {
    return undefined;
  }

  const updated: InvestigationSession = {
    ...existing,
    updatedAt: Date.now(),
  };
  if (patch.status) {
    updated.status = patch.status;
  }
  if (patch.addHypothesis) {
    updated.hypotheses = [...existing.hypotheses, patch.addHypothesis];
  }
  if (patch.addSuspectedComponent) {
    updated.suspectedComponents = existing.suspectedComponents.includes(
      patch.addSuspectedComponent,
    )
      ? existing.suspectedComponents
      : [...existing.suspectedComponents, patch.addSuspectedComponent];
  }
  if (patch.diagnosis !== undefined) {
    updated.diagnosis = patch.diagnosis;
  }
  if (patch.confidence !== undefined) {
    updated.confidence = patch.confidence;
  }

  investigationsByConversation.set(key, updated);
  return { ...updated };
}

/** Record the outcome of a verification attempt against the current diagnosis. Returns `undefined` when no investigation is active. */
export function recordVerificationAttempt(
  conversationId: string | undefined,
  attempt: { outcome: VerificationAttempt["outcome"]; notes?: string },
): InvestigationSession | undefined {
  const key = keyFor(conversationId);
  const existing = investigationsByConversation.get(key);
  if (!existing) {
    return undefined;
  }

  const updated: InvestigationSession = {
    ...existing,
    updatedAt: Date.now(),
    verificationAttempts: [
      ...existing.verificationAttempts,
      { id: generateId(), timestamp: Date.now(), ...attempt },
    ],
  };
  investigationsByConversation.set(key, updated);
  return { ...updated };
}

/** Move the investigation to a terminal state. Evidence is untouched — it remains available for the rest of the conversation. */
export function stopInvestigation(
  conversationId: string | undefined,
  status: "stopped" | "resolved" | "failed" = "stopped",
): InvestigationSession | undefined {
  return updateInvestigation(conversationId, { status });
}

/** Discard the investigation lifecycle state for a conversation (not its evidence — see `clearEvidence`). */
export function clearInvestigation(conversationId: string | undefined): void {
  investigationsByConversation.delete(keyFor(conversationId));
}

/** Test/debug helper: how many conversations currently have an active investigation record. */
export function getTrackedInvestigationCount(): number {
  return investigationsByConversation.size;
}
