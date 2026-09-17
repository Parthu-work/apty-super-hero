/**
 * Derives Apty component health from real diagnostic evidence already
 * collected for a conversation — never fabricated or polled independently.
 *
 * Apty ships two Chrome extensions: Studio (authoring), and one runtime
 * extension that goes by several names (Client/Widget/Player) but is
 * architecturally one component. This module reports exactly two grouped
 * rows — "Apty Client / Widget / Player" and "Apty Studio" — never four
 * separate "Client"/"Widget"/"Studio"/"Service Worker" rows, while still
 * keeping the underlying per-probe detail (which global/channel actually
 * reported what) available via `subComponents` for drill-down.
 *
 * Every `get_apty_*_diagnostics` tool records a `*-status` evidence entry
 * on every call, success or failure (see `packages/browser-runtime/src/tools/apty.ts`),
 * unlike log entries which are only recorded at warn/error level. That
 * status record is the only honest source of "is this component healthy
 * right now" this UI has — if a component was never checked in this
 * conversation, health is reported as `not_checked`, never guessed.
 */
import type {
  AptyClientStatus,
  AptyServiceWorkerStatus,
  AptyStudioStatus,
  AptyWidgetStatus,
  DiagnosticEvidence,
  EvidenceSource,
} from "@apty/browser-runtime";

export type ComponentHealthState =
  | "healthy"
  | "warning"
  | "error"
  | "not_configured"
  | "not_detected"
  | "not_checked";

export interface SubComponentHealth {
  key: "apty-client" | "apty-widget" | "service-worker" | "apty-studio";
  label: string;
  state: ComponentHealthState;
  detail: string;
  lastCheckedAt?: number;
}

/** One of the two Apty product components an investigation/UI can present — see the module doc comment. */
export type ComponentGroupKind = "apty-client-widget-player" | "apty-studio";

export interface ComponentHealth {
  kind: ComponentGroupKind;
  label: string;
  /** Aggregated across the group's sub-components — the worst signal wins (error > warning > healthy > not_detected > not_configured > not_checked). */
  state: ComponentHealthState;
  detail: string;
  subComponents: SubComponentHealth[];
}

const SUB_COMPONENT_LABELS: Record<SubComponentHealth["key"], string> = {
  "apty-client": "Client",
  "apty-widget": "Widget",
  "service-worker": "Service Worker",
  "apty-studio": "Studio",
};

const STATUS_EVIDENCE_TYPE: Record<SubComponentHealth["key"], string> = {
  "apty-client": "client-status",
  "apty-widget": "widget-status",
  "service-worker": "service-worker-status",
  "apty-studio": "studio-status",
};

function latestStatusEvidence(
  evidence: DiagnosticEvidence[],
  source: EvidenceSource,
  type: string,
): DiagnosticEvidence | undefined {
  let latest: DiagnosticEvidence | undefined;
  for (const item of evidence) {
    if (item.source !== source || item.type !== type) continue;
    if (!latest || item.timestamp > latest.timestamp) {
      latest = item;
    }
  }
  return latest;
}

function healthFromWidgetStatus(status: AptyWidgetStatus): {
  state: ComponentHealthState;
  detail: string;
} {
  if (status.status === "not_configured") {
    return {
      state: "not_configured",
      detail: "Requires Apty-side integration",
    };
  }
  if (status.status === "unavailable") {
    return { state: "not_detected", detail: "Not present on this page" };
  }
  if (status.status === "error") {
    return { state: "error", detail: status.error ?? "Diagnostic error" };
  }
  if (status.lastError) {
    return { state: "warning", detail: status.lastError };
  }
  if (!status.initialized) {
    return { state: "warning", detail: "Not yet initialized" };
  }
  return { state: "healthy", detail: "Initialized" };
}

function healthFromClientStatus(status: AptyClientStatus): {
  state: ComponentHealthState;
  detail: string;
} {
  if (status.status === "not_configured") {
    return {
      state: "not_configured",
      detail: "Requires Apty-side integration",
    };
  }
  if (status.status === "unavailable") {
    return { state: "not_detected", detail: "Not present on this page" };
  }
  if (status.status === "error") {
    return { state: "error", detail: status.error ?? "Diagnostic error" };
  }
  if (!status.initialized) {
    return { state: "warning", detail: "Not yet initialized" };
  }
  return {
    state: "healthy",
    detail: status.version ? `Initialized (v${status.version})` : "Initialized",
  };
}

function healthFromStudioStatus(status: AptyStudioStatus): {
  state: ComponentHealthState;
  detail: string;
} {
  if (status.status === "not_configured") {
    return {
      state: "not_configured",
      detail: "Requires Apty-side integration",
    };
  }
  if (status.status === "unavailable") {
    return { state: "not_detected", detail: "Not responding" };
  }
  if (status.status === "error") {
    return { state: "error", detail: status.error ?? "Diagnostic error" };
  }
  return { state: "healthy", detail: status.active ? "Active" : "Connected" };
}

function healthFromServiceWorkerStatus(status: AptyServiceWorkerStatus): {
  state: ComponentHealthState;
  detail: string;
} {
  if (status.status === "not_configured") {
    return {
      state: "not_configured",
      detail: "Requires Apty-side integration",
    };
  }
  if (status.status === "unavailable") {
    return { state: "not_detected", detail: "Not responding" };
  }
  if (status.status === "error") {
    return { state: "error", detail: status.error ?? "Diagnostic error" };
  }
  if (status.running === false) {
    return { state: "warning", detail: "Not running" };
  }
  return { state: "healthy", detail: "Connected" };
}

function deriveSubComponent(
  evidence: DiagnosticEvidence[],
  key: SubComponentHealth["key"],
  source: EvidenceSource,
): SubComponentHealth {
  const found = latestStatusEvidence(
    evidence,
    source,
    STATUS_EVIDENCE_TYPE[key],
  );
  if (!found) {
    return {
      key,
      label: SUB_COMPONENT_LABELS[key],
      state: "not_checked",
      detail: "Not checked yet in this conversation",
    };
  }

  const data = found.data;
  let derived: { state: ComponentHealthState; detail: string };
  switch (key) {
    case "apty-widget":
      derived = healthFromWidgetStatus(data as AptyWidgetStatus);
      break;
    case "apty-client":
      derived = healthFromClientStatus(data as AptyClientStatus);
      break;
    case "service-worker":
      derived = healthFromServiceWorkerStatus(data as AptyServiceWorkerStatus);
      break;
    case "apty-studio":
      derived = healthFromStudioStatus(data as AptyStudioStatus);
      break;
  }

  return {
    key,
    label: SUB_COMPONENT_LABELS[key],
    state: derived.state,
    detail: derived.detail,
    lastCheckedAt: found.timestamp,
  };
}

/** Worst-signal-wins ordering for aggregating sub-component states into one group state. */
const STATE_SEVERITY: Record<ComponentHealthState, number> = {
  error: 5,
  warning: 4,
  healthy: 3,
  not_detected: 2,
  not_configured: 1,
  not_checked: 0,
};

function aggregate(subComponents: SubComponentHealth[]): {
  state: ComponentHealthState;
  detail: string;
} {
  const worst = subComponents.reduce((a, b) =>
    STATE_SEVERITY[b.state] > STATE_SEVERITY[a.state] ? b : a,
  );
  if (subComponents.length === 1) {
    return { state: worst.state, detail: worst.detail };
  }
  const detail = subComponents
    .filter((s) => s.state !== "not_checked")
    .map((s) => `${s.label}: ${s.detail}`)
    .join(" · ");
  return {
    state: worst.state,
    detail: detail || "Not checked yet in this conversation",
  };
}

/**
 * Derive the current health of both Apty component groups from evidence
 * already collected in this conversation. Pure function — same evidence
 * in, same result out.
 */
export function deriveComponentHealth(
  evidence: DiagnosticEvidence[],
): ComponentHealth[] {
  const runtimeSubs: SubComponentHealth[] = [
    deriveSubComponent(evidence, "apty-client", "apty-client"),
    deriveSubComponent(evidence, "apty-widget", "apty-widget"),
    deriveSubComponent(evidence, "service-worker", "service-worker"),
  ];
  const studioSubs: SubComponentHealth[] = [
    deriveSubComponent(evidence, "apty-studio", "apty-studio"),
  ];

  const runtimeAggregate = aggregate(runtimeSubs);
  const studioAggregate = aggregate(studioSubs);

  return [
    {
      kind: "apty-client-widget-player",
      label: "Apty Client / Widget / Player",
      state: runtimeAggregate.state,
      detail: runtimeAggregate.detail,
      subComponents: runtimeSubs,
    },
    {
      kind: "apty-studio",
      label: "Apty Studio",
      state: studioAggregate.state,
      detail: studioAggregate.detail,
      subComponents: studioSubs,
    },
  ];
}
