/**
 * Deterministic evidence correlation.
 *
 * The model should not have to infer every relationship between raw tool
 * outputs from scratch on every turn — that's slow, inconsistent, and easy
 * to get wrong in a long conversation. This module groups
 * `DiagnosticEvidence` records that plausibly describe the same underlying
 * incident, using only timestamps and shared identifiers (never guessing
 * at meaning), and hands the model a correlated timeline instead of a flat
 * list.
 *
 * This is intentionally simple: exact-match grouping on `requestId`/
 * `correlationId`, plus a bounded time-window fallback scoped to the same
 * tab. It is a pre-pass that narrows the model's search space, not a
 * replacement for the model's own reasoning about *why* things are
 * related.
 */
import type { DiagnosticEvidence } from "./types.js";

export interface CorrelationCluster {
  clusterId: string;
  startTimestamp: number;
  endTimestamp: number;
  /** Evidence in this cluster, sorted oldest first. */
  evidence: DiagnosticEvidence[];
  /** True when the cluster contains a recognizable failure signal spanning more than one source (e.g. a failed network request plus a console error). */
  likelySameIncident: boolean;
  /** Human-readable one-line summary, e.g. "Network request failed (500) with a console error 340ms later". */
  summary: string;
}

export interface CorrelateOptions {
  /**
   * Maximum gap, in ms, between two events for them to be considered part
   * of the same cluster when no explicit `requestId`/`correlationId` links
   * them. Default 2000ms — long enough to catch a click → request →
   * response → console-error chain, short enough not to lump unrelated
   * activity together.
   */
  windowMs?: number;
}

const DEFAULT_WINDOW_MS = 2000;

interface UnionFind {
  parent: number[];
  find(x: number): number;
  union(a: number, b: number): void;
}

function createUnionFind(size: number): UnionFind {
  const parent = Array.from({ length: size }, (_, i) => i);
  const uf: UnionFind = {
    parent,
    find(x: number): number {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    },
    union(a: number, b: number): void {
      const rootA = uf.find(a);
      const rootB = uf.find(b);
      if (rootA !== rootB) {
        parent[rootA] = rootB;
      }
    },
  };
  return uf;
}

/**
 * Group evidence into clusters that plausibly describe the same incident.
 */
export function correlateEvidence(
  evidence: DiagnosticEvidence[],
  options: CorrelateOptions = {},
): CorrelationCluster[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const sorted = [...evidence].sort((a, b) => a.timestamp - b.timestamp);
  const uf = createUnionFind(sorted.length);

  // Exact-match grouping: same requestId or same correlationId always
  // joins, regardless of time gap (a slow request can still be the same
  // incident).
  const byRequestId = new Map<string, number[]>();
  const byCorrelationId = new Map<string, number[]>();
  sorted.forEach((item, index) => {
    if (item.requestId) {
      const bucket = byRequestId.get(item.requestId) ?? [];
      bucket.push(index);
      byRequestId.set(item.requestId, bucket);
    }
    if (item.correlationId) {
      const bucket = byCorrelationId.get(item.correlationId) ?? [];
      bucket.push(index);
      byCorrelationId.set(item.correlationId, bucket);
    }
  });
  for (const bucket of [...byRequestId.values(), ...byCorrelationId.values()]) {
    for (let i = 1; i < bucket.length; i++) {
      uf.union(bucket[0]!, bucket[i]!);
    }
  }

  // Time-window fallback: adjacent events (in sorted order) within
  // `windowMs` of each other join if they're either both scoped to the
  // same tab, or at least one is inherently shared/tab-agnostic (e.g. a
  // service-worker log can plausibly relate to activity in any tab around
  // that time — see `types.ts`'s `scope` field).
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    if (next.timestamp - current.timestamp > windowMs) {
      continue;
    }
    const sameTab = current.tabId != null && current.tabId === next.tabId;
    const eitherShared = current.scope === "shared" || next.scope === "shared";
    if (sameTab || eitherShared) {
      uf.union(i, i + 1);
    }
  }

  const clusterIndices = new Map<number, number[]>();
  sorted.forEach((_, index) => {
    const root = uf.find(index);
    const bucket = clusterIndices.get(root) ?? [];
    bucket.push(index);
    clusterIndices.set(root, bucket);
  });

  const clusters: CorrelationCluster[] = [];
  let clusterSeq = 0;
  for (const indices of clusterIndices.values()) {
    const clusterEvidence = indices
      .sort((a, b) => a - b)
      .map((i) => sorted[i]!);
    const startTimestamp = clusterEvidence[0]!.timestamp;
    const endTimestamp = clusterEvidence[clusterEvidence.length - 1]!.timestamp;
    const likelySameIncident = hasCrossSourceFailureSignal(clusterEvidence);
    clusters.push({
      clusterId: `cluster_${clusterSeq++}`,
      startTimestamp,
      endTimestamp,
      evidence: clusterEvidence,
      likelySameIncident,
      summary: summarizeCluster(clusterEvidence, likelySameIncident),
    });
  }

  clusters.sort((a, b) => a.startTimestamp - b.startTimestamp);
  return clusters;
}

/** A network failure (>=400 or explicitly failed) plus a console/runtime error/exception in the same cluster is a strong "this is one incident" signal. */
function hasCrossSourceFailureSignal(evidence: DiagnosticEvidence[]): boolean {
  const hasNetworkFailure = evidence.some(
    (e) => e.source === "network" && isFailureType(e.type),
  );
  const hasConsoleOrRuntimeError = evidence.some(
    (e) =>
      (e.source === "console" || e.source === "runtime") &&
      isFailureType(e.type),
  );
  return hasNetworkFailure && hasConsoleOrRuntimeError;
}

function isFailureType(type: string): boolean {
  return /error|fail|exception|reject/i.test(type);
}

function summarizeCluster(
  evidence: DiagnosticEvidence[],
  likelySameIncident: boolean,
): string {
  if (evidence.length === 1) {
    const only = evidence[0]!;
    return `${describeSource(only.source)} — ${only.type}`;
  }

  const sources = [...new Set(evidence.map((e) => describeSource(e.source)))];
  const span =
    evidence[evidence.length - 1]!.timestamp - evidence[0]!.timestamp;
  const base = `${evidence.length} events across ${sources.join(", ")} within ${span}ms`;
  return likelySameIncident ? `${base} — likely the same failure` : base;
}

function describeSource(source: DiagnosticEvidence["source"]): string {
  switch (source) {
    case "dom":
      return "DOM";
    case "console":
      return "console";
    case "network":
      return "network";
    case "runtime":
      return "browser runtime";
    case "apty-client":
      return "Apty Client";
    case "apty-widget":
      return "Apty Widget";
    case "apty-studio":
      return "Apty Studio";
    case "service-worker":
      return "Apty Service Worker";
    default:
      return source;
  }
}

/** Render clusters as a compact, human-readable timeline — cheaper for the model to read than raw JSON, and matches the format an eventual UI timeline would show. */
export function formatTimeline(clusters: CorrelationCluster[]): string {
  if (clusters.length === 0) {
    return "No evidence collected yet.";
  }

  const lines: string[] = [];
  for (const cluster of clusters) {
    const marker = cluster.likelySameIncident ? "⚠️ " : "";
    lines.push(
      `${marker}${formatTime(cluster.startTimestamp)} — ${cluster.summary}`,
    );
    for (const item of cluster.evidence) {
      lines.push(
        `    ${formatTime(item.timestamp)} — [${item.source}] ${item.type}`,
      );
    }
  }
  return lines.join("\n");
}

function formatTime(timestampMs: number): string {
  return (
    new Date(timestampMs).toISOString().split("T")[1]?.slice(0, 12) ??
    String(timestampMs)
  );
}
