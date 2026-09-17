export type {
  ApplicationAuditLimits,
  ApplicationAuditOutcome,
  ApplicationAuditProgress,
  RunApplicationAuditOptions,
} from "./application-audit.js";
export { runApplicationDomHealthAudit } from "./application-audit.js";
export type {
  ApplicationAuditResult,
  ApplicationCoverage,
  PageAuditRecord,
  PageAuditStatus,
  PageDiscoverySource,
  PageNavigationModel,
} from "./application-scoring.js";
export { buildApplicationAuditResult } from "./application-scoring.js";
export {
  NotConfiguredClientDiagnosticsProvider,
  ScriptingClientDiagnosticsProvider,
} from "./client-diagnostics.js";
export {
  type AptyIntegrationConfig,
  getAptyIntegrationConfig,
  setAptyIntegrationConfig,
} from "./config.js";
export type { DomHealthAuditOutcome } from "./dom-health.js";
export { isUnsupportedPage, runDomHealthAudit } from "./dom-health.js";
export type {
  DomHealthAuditResult,
  DomHealthConfidence,
  DomHealthGrade,
  DomHealthMetricDetails,
  DomHealthMetricKey,
  DomHealthMetrics,
  DomHealthRecommendation,
  DomHealthRisk,
} from "./dom-health-scoring.js";
export { buildDomHealthAuditResult } from "./dom-health-scoring.js";
export {
  type CorrelateOptions,
  type CorrelationCluster,
  correlateEvidence,
  formatTimeline,
} from "./evidence-correlation.js";
export {
  clearEvidence,
  getEvidence,
  getTrackedConversationCount,
  recordEvidence,
} from "./evidence-store.js";
export type {
  ConnectErrorCode,
  ConnectResult,
  DisconnectResult,
  ExtensionCaptureEntry,
  ExtensionConnectionStatus,
  ExtensionLogEntry,
  InspectResourceResult,
  InspectResourceStatus,
  ListResourcesResult,
  MatchedResource,
} from "./extension-network-inspector.js";
export {
  connectExtensionClient,
  disconnectExtensionClient,
  getActiveExtensionConnectionCount,
  getExtensionConnectionStatus,
  inspectResource,
  isValidExtensionId,
  listObservedResources,
  listServiceWorkerLogs,
  MAX_INLINE_BODY_CHARS,
  matchResources,
} from "./extension-network-inspector.js";
export { sendExternalMessage } from "./external-messaging.js";
export type {
  DuplicateCallWarning,
  OrchestratorAction,
  OrchestratorBudgetStatus,
  ToolCallRecord,
} from "./investigation-orchestrator.js";
export {
  clearToolCallLog,
  decideNextAction,
  getBudgetStatus,
  getToolCallLog,
  getTrackedCallLogCount,
  ORCHESTRATOR_LIMITS,
  recordToolCall,
} from "./investigation-orchestrator.js";
export type { InvestigationPlan, PlanStep } from "./investigation-planner.js";
export { planInvestigation } from "./investigation-planner.js";
export type {
  AptyComponentKind,
  Hypothesis,
  HypothesisStatus,
  InvestigationSession,
  InvestigationStatus,
  StartInvestigationInput,
  UpdateHypothesisInput,
  UpdateInvestigationInput,
  VerificationAttempt,
} from "./investigation-session.js";
export {
  clearInvestigation,
  getInvestigation,
  getTrackedInvestigationCount,
  recordVerificationAttempt,
  startInvestigation,
  stopInvestigation,
  updateInvestigation,
} from "./investigation-session.js";
export type {
  ClassifiableLogEntry,
  LogCategory,
  LogClassificationHint,
} from "./log-classification.js";
export {
  classifyLogEntry,
  summarizeLogCategories,
} from "./log-classification.js";
export type {
  CapturedNetworkRequest,
  NetworkCaptureSession,
  NetworkCaptureStatus,
  StartCaptureResult,
  StopCaptureResult,
} from "./network-capture-session.js";
export {
  getActiveCaptureCount,
  getNetworkCaptureStatus,
  startNetworkCapture,
  stopNetworkCapture,
} from "./network-capture-session.js";
export type { NavigationModel } from "./page-navigation.js";
export {
  collectPageLinks,
  getNavigationModel,
  navigateTab,
  waitForDomStable,
  waitForTabLoad,
} from "./page-navigation.js";
export {
  redactHeaders,
  redactLog,
  redactLogs,
  redactSensitiveText,
} from "./redact.js";
export {
  ConfiguredServiceWorkerDiagnosticsProvider,
  NotConfiguredServiceWorkerDiagnosticsProvider,
  type ServiceWorkerDiagnosticsConfig,
} from "./service-worker-diagnostics.js";
export {
  ExternalMessageStudioDiagnosticsProvider,
  NotConfiguredStudioDiagnosticsProvider,
} from "./studio-diagnostics.js";
export type {
  AptyClientDiagnosticsProvider,
  AptyClientStatus,
  AptyIntegrationStatus,
  AptyLog,
  AptyObservedResource,
  AptyResourceBody,
  AptyServiceWorkerDiagnosticsProvider,
  AptyServiceWorkerStatus,
  AptyStudioDiagnosticsProvider,
  AptyStudioStatus,
  AptyWidgetDiagnosticsProvider,
  AptyWidgetStatus,
  DiagnosisConfidence,
  DiagnosticEvidence,
  EvidenceSource,
  NewDiagnosticEvidence,
} from "./types.js";
export {
  NotConfiguredWidgetDiagnosticsProvider,
  ScriptingWidgetDiagnosticsProvider,
} from "./widget-diagnostics.js";
