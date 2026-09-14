/**
 * Apty diagnostic types
 *
 * Shared vocabulary for the Apty Live Browser Debugging Agent: a normalized
 * evidence shape the agent can correlate across sources, confidence levels
 * for the final diagnosis, and clean provider interfaces for Apty-specific
 * integrations (Widget, Studio, Client, Service Worker).
 *
 * IMPORTANT: the provider interfaces here are contracts, not working
 * integrations. Chrome's extension security model does not let one
 * extension read another's private memory or service-worker state, so a
 * real implementation for Studio/Widget/Service-Worker diagnostics requires
 * an explicit, mutually-agreed communication mechanism on the Apty side
 * (see config.ts and the *-diagnostics.ts files in this directory for the
 * current status of each).
 */

/** Where a piece of diagnostic evidence came from. */
export type EvidenceSource =
  | "dom"
  | "console"
  | "network"
  | "runtime"
  | "apty-client"
  | "apty-widget"
  | "apty-studio"
  | "service-worker";

/** A single normalized piece of evidence the agent can reason over. */
export interface DiagnosticEvidence {
  /** Unique id for this evidence record — lets a diagnosis cite exactly which pieces support it. */
  evidenceId: string;
  /** Which conversation collected this — `undefined` when collected outside a chat conversation (e.g. via the MCP bridge). */
  conversationId?: string;
  source: EvidenceSource;
  timestamp: number;
  /** Short machine-readable event type, e.g. "console-error", "http-error", "widget-status". */
  type: string;
  /** The tab this evidence is about, when known. `null`/absent for evidence that is inherently not tab-scoped (e.g. shared service-worker logs). */
  tabId?: number | null;
  /** Frame this evidence occurred in, when known (main frame vs. an iframe). */
  frameId?: string;
  /** Page URL/origin the evidence relates to, when known. */
  url?: string;
  /** CDP/network request id, when this evidence is a network event — lets request/response pairs correlate exactly. */
  requestId?: string;
  /** Free-form correlation key for evidence that isn't network traffic but still ties to a specific user action/event (e.g. an Apty workflow-step id). */
  correlationId?: string;
  /** Whether this evidence is scoped to a specific tab or is inherently shared/global (e.g. the Apty service worker). Mirrors the "shared, not falsely attributed" pattern already used by the service-worker tool. */
  scope: "tab" | "shared" | "unknown";
  /** The actual payload. Free-form, but must already be redacted (see redact.ts) before this is constructed. */
  data: unknown;
}

/** Fields the caller supplies when recording evidence — `evidenceId` is always generated, `scope` defaults to `"tab"` when a `tabId` is present. */
export type NewDiagnosticEvidence = Omit<
  DiagnosticEvidence,
  "evidenceId" | "scope"
> & { scope?: DiagnosticEvidence["scope"] };

/** Confidence levels the agent must use when stating a diagnosis — never fabricate certainty. */
export type DiagnosisConfidence =
  | "confirmed"
  | "likely"
  | "possible"
  | "unknown";

/**
 * Generic status for an Apty integration that may or may not be reachable
 * on the current page. `not_configured` and `unavailable` are distinct:
 * the former means the extension/endpoint ID hasn't been set up at all,
 * the latter means it was configured but didn't respond (e.g. Apty isn't
 * loaded on this page).
 */
export type AptyIntegrationStatus =
  | "ok"
  | "not_configured"
  | "unavailable"
  | "error";

export interface AptyLog {
  level: "debug" | "log" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

export interface AptyClientStatus {
  status: AptyIntegrationStatus;
  loaded?: boolean;
  initialized?: boolean;
  version?: string;
  error?: string;
}

export interface AptyWidgetStatus {
  status: AptyIntegrationStatus;
  loaded?: boolean;
  initialized?: boolean;
  domPresent?: boolean;
  visible?: boolean;
  lastError?: string;
  error?: string;
}

export interface AptyStudioStatus {
  status: AptyIntegrationStatus;
  active?: boolean;
  selectionMode?: boolean;
  lastSelectedSelector?: string;
  error?: string;
}

export interface AptyServiceWorkerStatus {
  status: AptyIntegrationStatus;
  running?: boolean;
  lastActivity?: number;
  error?: string;
}

/**
 * Diagnostics for the Apty Client (the base runtime the Widget/Studio sit on top of).
 * See client-diagnostics.ts for the current implementation status.
 */
export interface AptyClientDiagnosticsProvider {
  getStatus(): Promise<AptyClientStatus>;
  getLogs(): Promise<AptyLog[]>;
}

/**
 * Diagnostics for the Apty Widget (in-app guidance UI shown to end users).
 * See widget-diagnostics.ts for the current implementation status.
 */
export interface AptyWidgetDiagnosticsProvider {
  getStatus(): Promise<AptyWidgetStatus>;
  getLogs(): Promise<AptyLog[]>;
}

/**
 * Diagnostics for Apty Studio (the workflow-authoring tool used to build
 * content). See studio-diagnostics.ts for the current implementation status.
 */
export interface AptyStudioDiagnosticsProvider {
  getStatus(): Promise<AptyStudioStatus>;
  getLogs(): Promise<AptyLog[]>;
}

/**
 * Diagnostics for Apty's own service worker. A Chrome extension cannot
 * reach into another extension's private service-worker memory — this
 * requires Apty's service worker to expose logs/status through an explicit
 * channel (message passing, a diagnostic endpoint, etc). See
 * service-worker-diagnostics.ts for the current implementation status.
 */
export interface AptyServiceWorkerDiagnosticsProvider {
  getStatus(): Promise<AptyServiceWorkerStatus>;
  getLogs(): Promise<AptyLog[]>;
}
