/**
 * Presentation metadata for investigation lifecycle states — kept separate
 * from the data layer (`use-investigation-data.ts`) so components never
 * have to invent a label/color for a status themselves.
 */
import type { InvestigationStatus } from "@apty/browser-runtime";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import type { ComponentHealthState } from "./component-health";

type Translate = I18nContextValue["t"];

export type DisplayStatus = "idle" | InvestigationStatus;

export interface StatusMeta {
  label: string;
  /** Whether this status represents work actually in progress right now (for a "still real, not fabricated" progress indicator). */
  inProgress: boolean;
  tone: "neutral" | "active" | "success" | "warning" | "danger";
}

const STATUS_META: Record<
  DisplayStatus,
  Omit<StatusMeta, "label"> & { label: TranslationKey }
> = {
  idle: {
    label: "statusMeta.investigation.idle",
    inProgress: false,
    tone: "neutral",
  },
  starting: {
    label: "statusMeta.investigation.starting",
    inProgress: true,
    tone: "active",
  },
  investigating: {
    label: "statusMeta.investigation.investigating",
    inProgress: true,
    tone: "active",
  },
  collecting_evidence: {
    label: "statusMeta.investigation.collectingEvidence",
    inProgress: true,
    tone: "active",
  },
  analyzing: {
    label: "statusMeta.investigation.analyzing",
    inProgress: true,
    tone: "active",
  },
  verifying: {
    label: "statusMeta.investigation.verifying",
    inProgress: true,
    tone: "active",
  },
  resolved: {
    label: "statusMeta.investigation.resolved",
    inProgress: false,
    tone: "success",
  },
  failed: {
    label: "statusMeta.investigation.failed",
    inProgress: false,
    tone: "danger",
  },
  stopped: {
    label: "statusMeta.investigation.stopped",
    inProgress: false,
    tone: "neutral",
  },
};

export function describeInvestigationStatus(
  status: DisplayStatus,
  t: Translate,
): StatusMeta {
  const meta = STATUS_META[status];
  return { ...meta, label: t(meta.label) };
}

export function isTerminalStatus(status: InvestigationStatus): boolean {
  return status === "resolved" || status === "failed" || status === "stopped";
}

const COMPONENT_HEALTH_META: Record<
  ComponentHealthState,
  { label: TranslationKey; tone: StatusMeta["tone"]; symbol: string }
> = {
  healthy: {
    label: "statusMeta.componentHealth.healthy",
    tone: "success",
    symbol: "✓",
  },
  warning: {
    label: "statusMeta.componentHealth.warning",
    tone: "warning",
    symbol: "⚠",
  },
  error: {
    label: "statusMeta.componentHealth.error",
    tone: "danger",
    symbol: "✕",
  },
  not_configured: {
    label: "statusMeta.componentHealth.notConfigured",
    tone: "neutral",
    symbol: "?",
  },
  not_detected: {
    label: "statusMeta.componentHealth.notDetected",
    tone: "neutral",
    symbol: "?",
  },
  not_checked: {
    label: "statusMeta.componentHealth.notChecked",
    tone: "neutral",
    symbol: "·",
  },
};

export function describeComponentHealth(
  state: ComponentHealthState,
  t: Translate,
) {
  const meta = COMPONENT_HEALTH_META[state];
  return { ...meta, label: t(meta.label) };
}

/** Friendly labels for `AptyComponentKind` (investigation-session.ts) — the unified two-component model, never a 4-way Client/Widget/Studio/Service-Worker split. */
const APTY_COMPONENT_LABELS: Record<
  "apty-client-widget-player" | "apty-studio",
  TranslationKey
> = {
  "apty-client-widget-player": "statusMeta.aptyComponent.clientWidgetPlayer",
  "apty-studio": "statusMeta.aptyComponent.studio",
};

export function describeAptyComponent(kind: string, t: Translate): string {
  const label =
    APTY_COMPONENT_LABELS[kind as "apty-client-widget-player" | "apty-studio"];
  return label ? t(label) : kind;
}

const HYPOTHESIS_STATUS_META: Record<
  "open" | "testing" | "supported" | "rejected" | "confirmed" | "inconclusive",
  { label: TranslationKey; tone: StatusMeta["tone"] }
> = {
  open: { label: "statusMeta.hypothesis.open", tone: "neutral" },
  testing: { label: "statusMeta.hypothesis.testing", tone: "active" },
  supported: { label: "statusMeta.hypothesis.supported", tone: "success" },
  rejected: { label: "statusMeta.hypothesis.rejected", tone: "danger" },
  confirmed: { label: "statusMeta.hypothesis.confirmed", tone: "success" },
  inconclusive: {
    label: "statusMeta.hypothesis.inconclusive",
    tone: "neutral",
  },
};

export function describeHypothesisStatus(status: string, t: Translate) {
  const meta =
    HYPOTHESIS_STATUS_META[status as keyof typeof HYPOTHESIS_STATUS_META];
  return meta
    ? { ...meta, label: t(meta.label) }
    : { label: status, tone: "neutral" as const };
}
