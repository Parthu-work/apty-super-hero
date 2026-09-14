/**
 * Derives Apty component health (Client/Widget/Studio/Service Worker) from
 * real diagnostic evidence already collected for a conversation — never
 * fabricated or polled independently.
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
  AptyComponentKind,
  AptyServiceWorkerStatus,
  AptyStudioStatus,
  AptyWidgetStatus,
  DiagnosticEvidence,
} from "@aipexstudio/browser-runtime";

export type ComponentHealthState =
  | "healthy"
  | "warning"
  | "error"
  | "not_configured"
  | "not_detected"
  | "not_checked";

export interface ComponentHealth {
  kind: AptyComponentKind;
  label: string;
  state: ComponentHealthState;
  /** Short human-readable explanation, e.g. "Initialized" or "Not yet initialized". */
  detail: string;
  /** When this component's status was last checked in this conversation, if ever. */
  lastCheckedAt?: number;
}

const COMPONENT_ORDER: readonly AptyComponentKind[] = [
  "apty-client",
  "apty-widget",
  "apty-studio",
  "service-worker",
];

const COMPONENT_LABELS: Record<AptyComponentKind, string> = {
  "apty-client": "Client",
  "apty-widget": "Widget",
  "apty-studio": "Studio",
  "service-worker": "Service Worker",
};

const STATUS_EVIDENCE_TYPE: Record<AptyComponentKind, string> = {
  "apty-client": "client-status",
  "apty-widget": "widget-status",
  "apty-studio": "studio-status",
  "service-worker": "service-worker-status",
};

function latestStatusEvidence(
  evidence: DiagnosticEvidence[],
  kind: AptyComponentKind,
): DiagnosticEvidence | undefined {
  const type = STATUS_EVIDENCE_TYPE[kind];
  let latest: DiagnosticEvidence | undefined;
  for (const item of evidence) {
    if (item.source !== kind || item.type !== type) continue;
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

/**
 * Derive the current health of all four Apty components from evidence
 * already collected in this conversation. Pure function — same evidence in,
 * same result out, so it's trivially testable and safe to call on every
 * render.
 */
export function deriveComponentHealth(
  evidence: DiagnosticEvidence[],
): ComponentHealth[] {
  return COMPONENT_ORDER.map((kind) => {
    const found = latestStatusEvidence(evidence, kind);
    if (!found) {
      return {
        kind,
        label: COMPONENT_LABELS[kind],
        state: "not_checked" as const,
        detail: "Not checked yet in this conversation",
      };
    }

    const data = found.data;
    let derived: { state: ComponentHealthState; detail: string };
    switch (kind) {
      case "apty-widget":
        derived = healthFromWidgetStatus(data as AptyWidgetStatus);
        break;
      case "apty-client":
        derived = healthFromClientStatus(data as AptyClientStatus);
        break;
      case "apty-studio":
        derived = healthFromStudioStatus(data as AptyStudioStatus);
        break;
      case "service-worker":
        derived = healthFromServiceWorkerStatus(
          data as AptyServiceWorkerStatus,
        );
        break;
    }

    return {
      kind,
      label: COMPONENT_LABELS[kind],
      state: derived.state,
      detail: derived.detail,
      lastCheckedAt: found.timestamp,
    };
  });
}
