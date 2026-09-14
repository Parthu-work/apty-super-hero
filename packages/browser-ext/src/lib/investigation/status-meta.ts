/**
 * Presentation metadata for investigation lifecycle states — kept separate
 * from the data layer (`use-investigation-data.ts`) so components never
 * have to invent a label/color for a status themselves.
 */
import type { InvestigationStatus } from "@aipexstudio/browser-runtime";
import type { ComponentHealthState } from "./component-health";

export type DisplayStatus = "idle" | InvestigationStatus;

export interface StatusMeta {
  label: string;
  /** Whether this status represents work actually in progress right now (for a "still real, not fabricated" progress indicator). */
  inProgress: boolean;
  tone: "neutral" | "active" | "success" | "warning" | "danger";
}

const STATUS_META: Record<DisplayStatus, StatusMeta> = {
  idle: { label: "Idle", inProgress: false, tone: "neutral" },
  starting: {
    label: "Starting investigation",
    inProgress: true,
    tone: "active",
  },
  investigating: { label: "Investigating", inProgress: true, tone: "active" },
  collecting_evidence: {
    label: "Collecting evidence",
    inProgress: true,
    tone: "active",
  },
  analyzing: { label: "Analyzing", inProgress: true, tone: "active" },
  verifying: { label: "Verifying diagnosis", inProgress: true, tone: "active" },
  resolved: { label: "Resolved", inProgress: false, tone: "success" },
  failed: { label: "Investigation failed", inProgress: false, tone: "danger" },
  stopped: { label: "Stopped", inProgress: false, tone: "neutral" },
};

export function describeInvestigationStatus(status: DisplayStatus): StatusMeta {
  return STATUS_META[status];
}

export function isTerminalStatus(status: InvestigationStatus): boolean {
  return status === "resolved" || status === "failed" || status === "stopped";
}

const COMPONENT_HEALTH_META: Record<
  ComponentHealthState,
  { label: string; tone: StatusMeta["tone"]; symbol: string }
> = {
  healthy: { label: "Healthy", tone: "success", symbol: "✓" },
  warning: { label: "Warning", tone: "warning", symbol: "⚠" },
  error: { label: "Error", tone: "danger", symbol: "✕" },
  not_configured: { label: "Not configured", tone: "neutral", symbol: "?" },
  not_detected: { label: "Not detected", tone: "neutral", symbol: "?" },
  not_checked: { label: "Not checked yet", tone: "neutral", symbol: "·" },
};

export function describeComponentHealth(state: ComponentHealthState) {
  return COMPONENT_HEALTH_META[state];
}
