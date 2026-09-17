/**
 * Investigation session lifecycle.
 *
 * The evidence store (`evidence-store.ts`) and correlation engine
 * (`evidence-correlation.ts`) answer "what has been observed so far in this
 * conversation" — they have no concept of "what is the agent's current
 * hypothesis" or "has this investigation been resolved". This module adds
 * that first-class lifecycle state on top of the existing evidence layer,
 * without duplicating it: an `InvestigationSession` never stores evidence
 * itself, only evidence *ids* referenced from hypotheses/plan steps.
 *
 * Deliberately `Map<conversationId, InvestigationSession>`, mirroring
 * `evidence-store.ts`'s per-conversation isolation — one investigation per
 * conversation, never leaking into another's.
 */
import { generateId } from "@apty/agent-core";
import type { InvestigationPlan } from "./investigation-planner.js";
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

/**
 * The Apty product components an investigation can be scoped to.
 *
 * Apty ships two Chrome extensions: the Studio authoring tool, and the
 * runtime extension that goes by several names (Client, Widget, Player)
 * depending on context but is architecturally *one* component. Modeling
 * "Client"/"Widget"/"Player"/"Service Worker" as four separate suspected
 * components would misrepresent Apty's actual product architecture and
 * fragment an investigation's view of "which Apty component is involved"
 * across names that all mean the same runtime. `EvidenceSource` (see
 * `types.ts`) stays granular at the evidence-collection layer — it still
 * matters *which probe* (the client global, the widget global, the
 * service-worker channel) produced a given piece of evidence — but at the
 * investigation level, the product-facing component is one of these two.
 */
export type AptyComponentKind = "apty-client-widget-player" | "apty-studio";

export interface VerificationAttempt {
  id: string;
  timestamp: number;
  outcome: "confirmed" | "not_confirmed" | "inconclusive";
  notes?: string;
  /** The hypothesis this verification attempt was testing, if any. */
  hypothesisId?: string;
}

export type HypothesisStatus =
  | "open"
  | "testing"
  | "supported"
  | "rejected"
  | "confirmed"
  | "inconclusive";

export interface Hypothesis {
  id: string;
  statement: string;
  status: HypothesisStatus;
  confidence: DiagnosisConfidence;
  /** `DiagnosticEvidence.evidenceId`s that support this hypothesis. */
  supportingEvidenceIds: string[];
  /** `DiagnosticEvidence.evidenceId`s that contradict this hypothesis. */
  contradictingEvidenceIds: string[];
  createdAt: number;
  updatedAt: number;
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
  hypotheses: Hypothesis[];
  verificationAttempts: VerificationAttempt[];
  /** A deterministic investigation plan (see `investigation-planner.ts`), if one was generated at start time. */
  plan?: InvestigationPlan;
  diagnosis?: string;
  confidence?: DiagnosisConfidence;
}

export interface StartInvestigationInput {
  conversationId: string;
  tabId: number | null;
  userProblem: string;
  suspectedComponents?: AptyComponentKind[];
  plan?: InvestigationPlan;
}

export interface UpdateHypothesisInput {
  id: string;
  status?: HypothesisStatus;
  confidence?: DiagnosisConfidence;
  addSupportingEvidenceId?: string;
  addContradictingEvidenceId?: string;
}

export interface UpdateInvestigationInput {
  status?: InvestigationStatus;
  addHypothesis?: string;
  updateHypothesis?: UpdateHypothesisInput;
  addSuspectedComponent?: AptyComponentKind;
  diagnosis?: string;
  confidence?: DiagnosisConfidence;
  completedPlanStepId?: string;
  skippedPlanStepId?: string;
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
    plan: input.plan,
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

function applyHypothesisUpdate(
  hypotheses: Hypothesis[],
  patch: UpdateHypothesisInput,
): Hypothesis[] {
  return hypotheses.map((h) => {
    if (h.id !== patch.id) return h;
    const updated: Hypothesis = { ...h, updatedAt: Date.now() };
    if (patch.status) updated.status = patch.status;
    if (patch.confidence !== undefined) updated.confidence = patch.confidence;
    if (patch.addSupportingEvidenceId) {
      updated.supportingEvidenceIds = h.supportingEvidenceIds.includes(
        patch.addSupportingEvidenceId,
      )
        ? h.supportingEvidenceIds
        : [...h.supportingEvidenceIds, patch.addSupportingEvidenceId];
    }
    if (patch.addContradictingEvidenceId) {
      updated.contradictingEvidenceIds = h.contradictingEvidenceIds.includes(
        patch.addContradictingEvidenceId,
      )
        ? h.contradictingEvidenceIds
        : [...h.contradictingEvidenceIds, patch.addContradictingEvidenceId];
    }
    return updated;
  });
}

/**
 * Apply a partial update to the conversation's current investigation.
 * Returns `undefined` (no-op) when no investigation has been started yet —
 * callers should tell the model to call `start_investigation` first rather
 * than silently creating one, so the lifecycle stays explicit.
 *
 * Enforces one rule server-side rather than relying on prompt discipline
 * alone: a diagnosis cannot be marked `confidence: "confirmed"` unless at
 * least one verification attempt in this investigation already resulted in
 * `"confirmed"`. An unverified "confirmed" is silently downgraded to
 * `"likely"` instead — callers can detect this by comparing the requested
 * confidence against `result.confidence`.
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
    const now = Date.now();
    const newHypothesis: Hypothesis = {
      id: generateId(),
      statement: patch.addHypothesis,
      status: "open",
      confidence: "unknown",
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      createdAt: now,
      updatedAt: now,
    };
    updated.hypotheses = [...existing.hypotheses, newHypothesis];
  }
  if (patch.updateHypothesis) {
    updated.hypotheses = applyHypothesisUpdate(
      updated.hypotheses ?? existing.hypotheses,
      patch.updateHypothesis,
    );
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
    const hasConfirmedVerification = existing.verificationAttempts.some(
      (a) => a.outcome === "confirmed",
    );
    updated.confidence =
      patch.confidence === "confirmed" && !hasConfirmedVerification
        ? "likely"
        : patch.confidence;
  }
  if (patch.completedPlanStepId && updated.plan) {
    updated.plan = {
      ...updated.plan,
      steps: updated.plan.steps.map((s) =>
        s.id === patch.completedPlanStepId ? { ...s, status: "done" } : s,
      ),
    };
  }
  if (patch.skippedPlanStepId && updated.plan) {
    updated.plan = {
      ...updated.plan,
      steps: updated.plan.steps.map((s) =>
        s.id === patch.skippedPlanStepId ? { ...s, status: "skipped" } : s,
      ),
    };
  }

  investigationsByConversation.set(key, updated);
  return { ...updated };
}

/**
 * Record the outcome of a verification attempt against the current
 * diagnosis (or a specific hypothesis, if `hypothesisId` is given — in
 * which case that hypothesis's status is updated to match: `confirmed` →
 * `confirmed`, `not_confirmed` → `rejected`, `inconclusive` → `testing`).
 * Returns `undefined` when no investigation is active.
 */
export function recordVerificationAttempt(
  conversationId: string | undefined,
  attempt: {
    outcome: VerificationAttempt["outcome"];
    notes?: string;
    hypothesisId?: string;
  },
): InvestigationSession | undefined {
  const key = keyFor(conversationId);
  const existing = investigationsByConversation.get(key);
  if (!existing) {
    return undefined;
  }

  let hypotheses = existing.hypotheses;
  if (attempt.hypothesisId) {
    const newStatus: HypothesisStatus =
      attempt.outcome === "confirmed"
        ? "confirmed"
        : attempt.outcome === "not_confirmed"
          ? "rejected"
          : "testing";
    hypotheses = applyHypothesisUpdate(hypotheses, {
      id: attempt.hypothesisId,
      status: newStatus,
    });
  }

  const updated: InvestigationSession = {
    ...existing,
    hypotheses,
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
