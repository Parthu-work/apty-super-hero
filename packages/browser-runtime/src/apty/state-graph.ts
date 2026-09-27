/**
 * Real application-state graph + backtracking model (replaces the flat
 * FIFO page-list model that had no way to return to a previously-visited
 * same-URL state before exploring its other siblings).
 *
 * The root cause this fixes: `application-audit.ts` previously queued
 * every safe-navigation candidate found on a state as soon as that state
 * was audited, then drained the queue strictly FIFO. For same-URL,
 * click-driven states (Infor LN's typical shape), the SECOND queued click
 * (e.g. "Menu 2" from state A) was only ever valid while the live browser
 * tab was still showing state A's DOM. But by the time it was dequeued,
 * the crawler had already clicked into state B (and possibly explored
 * B's own children too) — the live tab was sitting in a completely
 * different DOM, so "Menu 2"'s recorded `domPath`/`frameId` either
 * matched nothing, or worse, silently matched an unrelated element that
 * happened to share the same path in B's different markup. Sibling
 * branches were being lost or corrupted, never actually explored.
 *
 * This module tracks states as a graph (a discovery TREE for restoration
 * purposes — every non-seed state is reached via exactly one first-
 * discovering edge, recorded as `discoveredViaEdgeId`) with every
 * transition's real evidence attached, and exposes `getRestorationPath`
 * so a caller can replay the exact sequence of clicks needed to bring the
 * live tab back to an arbitrary previously-discovered state before
 * exploring one of its other children.
 */
import type { AuditStateFingerprint } from "./state-fingerprint.js";

export type TransitionTriggerKind = "seed" | "url-navigation" | "click";

export interface TransitionTrigger {
  kind: TransitionTriggerKind;
  /** For "url-navigation": the URL navigated to. */
  url?: string;
  /** For "click": which frame the candidate was found/clicked in. */
  frameId?: number;
  /** For "click": the candidate's DOM path, re-used verbatim to replay the click during restoration. */
  domPath?: string;
  /** For "click": human-readable label, for evidence/reporting only — never used to re-identify the element. */
  candidateText?: string;
}

export interface ApplicationStateNode {
  stateId: string;
  fingerprint: AuditStateFingerprint;
  url: string;
  title: string | null;
  discoveredAt: number;
  /** The edge that first discovered this state — null only for the seed/root state. This is what makes the graph a spanning TREE for restoration purposes, even though `edges` below may also record additional (non-restoration) transitions between already-known states. */
  discoveredViaEdgeId: string | null;
}

export interface StateTransitionEdge {
  id: string;
  sourceStateId: string;
  targetStateId: string;
  trigger: TransitionTrigger;
  /** Whether the target's URL (ignoring hash) equals the source's — the Infor LN-shaped case this whole model exists for. */
  sameUrl: boolean;
  beforeFingerprint: string;
  afterFingerprint: string;
  /** `historyApiCallCount` delta observed across this transition (pushState/replaceState/popstate/hashchange) — real evidence attached to the edge, not diagnostic-only telemetry it is discarded after logging. */
  historyEventDelta: number;
  /** "confirmed": a live before/after fingerprint comparison actually differed. "restored": this edge was replayed during backtracking and its target fingerprint matched what was originally recorded (see `RestorationResult`). */
  confidence: "confirmed" | "restored";
  createdAt: number;
}

export interface RestorationStepResult {
  edge: StateTransitionEdge;
  success: boolean;
  /** The fingerprint actually observed after replaying this edge — compared against `edge.afterFingerprint` to decide `success`. */
  observedFingerprint: string | null;
  reason?: string;
}

export interface RestorationResult {
  targetStateId: string;
  success: boolean;
  steps: RestorationStepResult[];
  /** Set only on failure — the step (0-based) where replay diverged from the recorded path. */
  failedAtStep?: number;
}

function normalizeUrlForCompare(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * The application-state discovery tree for one audit run. Deliberately
 * framework/chrome-API-free — `application-audit.ts` drives real
 * navigation/clicks and feeds the resulting fingerprints in; this class
 * only tracks identity, structure, and restoration paths.
 */
export class StateGraph {
  private nodes = new Map<string, ApplicationStateNode>();
  private edges: StateTransitionEdge[] = [];
  private fingerprintToStateId = new Map<string, string>();
  private currentStateId: string | null = null;
  private nextStateSeq = 0;
  private nextEdgeSeq = 0;

  getCurrentStateId(): string | null {
    return this.currentStateId;
  }

  getNode(stateId: string): ApplicationStateNode | undefined {
    return this.nodes.get(stateId);
  }

  getAllNodes(): ApplicationStateNode[] {
    return [...this.nodes.values()];
  }

  getAllEdges(): StateTransitionEdge[] {
    return [...this.edges];
  }

  /** Register the seed/root state. Call exactly once, before any transition. */
  addSeedState(
    fingerprint: AuditStateFingerprint,
    url: string,
    title: string | null,
  ): string {
    const stateId = `state-${this.nextStateSeq++}`;
    this.nodes.set(stateId, {
      stateId,
      fingerprint,
      url,
      title,
      discoveredAt: Date.now(),
      discoveredViaEdgeId: null,
    });
    this.fingerprintToStateId.set(fingerprint.fingerprint, stateId);
    this.currentStateId = stateId;
    return stateId;
  }

  private resolveState(
    fingerprint: AuditStateFingerprint,
    url: string,
    title: string | null,
    viaEdgeId: string,
  ): { stateId: string; isNew: boolean } {
    const existing = this.fingerprintToStateId.get(fingerprint.fingerprint);
    if (existing) return { stateId: existing, isNew: false };
    const stateId = `state-${this.nextStateSeq++}`;
    this.nodes.set(stateId, {
      stateId,
      fingerprint,
      url,
      title,
      discoveredAt: Date.now(),
      discoveredViaEdgeId: viaEdgeId,
    });
    this.fingerprintToStateId.set(fingerprint.fingerprint, stateId);
    return { stateId, isNew: true };
  }

  /**
   * Record a transition FROM the current live state to the state
   * described by `afterFingerprint`/`url`/`title`, and move
   * `currentStateId` there. The caller is responsible for having actually
   * driven the browser through this transition (a click or a real
   * navigation) — this only records the resulting graph structure.
   */
  recordTransition(params: {
    sourceStateId: string;
    trigger: TransitionTrigger;
    beforeFingerprint: AuditStateFingerprint;
    afterFingerprint: AuditStateFingerprint;
    url: string;
    title: string | null;
    historyEventDelta: number;
    confidence?: StateTransitionEdge["confidence"];
  }): { stateId: string; isNew: boolean; edge: StateTransitionEdge } {
    const source = this.nodes.get(params.sourceStateId);
    const edgeId = `edge-${this.nextEdgeSeq++}`;
    const { stateId, isNew } = this.resolveState(
      params.afterFingerprint,
      params.url,
      params.title,
      edgeId,
    );
    const edge: StateTransitionEdge = {
      id: edgeId,
      sourceStateId: params.sourceStateId,
      targetStateId: stateId,
      trigger: params.trigger,
      sameUrl: source
        ? normalizeUrlForCompare(params.url) ===
          normalizeUrlForCompare(source.url)
        : false,
      beforeFingerprint: params.beforeFingerprint.fingerprint,
      afterFingerprint: params.afterFingerprint.fingerprint,
      historyEventDelta: params.historyEventDelta,
      confidence: params.confidence ?? "confirmed",
      createdAt: Date.now(),
    };
    this.edges.push(edge);
    this.currentStateId = stateId;
    return { stateId, isNew, edge };
  }

  /** Set after a caller has independently verified (or is choosing to assume, on seed re-entry) which state is now live — used by restoration. */
  setCurrentStateId(stateId: string): void {
    this.currentStateId = stateId;
  }

  /**
   * The ordered list of edges needed to reach `targetStateId` from the
   * seed state — walks `discoveredViaEdgeId` back to the root. Empty when
   * `targetStateId` IS the seed (nothing to replay).
   */
  getRestorationPath(targetStateId: string): StateTransitionEdge[] {
    const path: StateTransitionEdge[] = [];
    let cur = this.nodes.get(targetStateId);
    const guard = new Set<string>();
    while (cur?.discoveredViaEdgeId) {
      if (guard.has(cur.stateId)) break; // defensive: never loop on a malformed graph
      guard.add(cur.stateId);
      const edge = this.edges.find((e) => e.id === cur!.discoveredViaEdgeId);
      if (!edge) break;
      path.unshift(edge);
      cur = this.nodes.get(edge.sourceStateId);
    }
    return path;
  }

  getSeedStateId(): string | null {
    for (const node of this.nodes.values()) {
      if (node.discoveredViaEdgeId === null) return node.stateId;
    }
    return null;
  }
}
