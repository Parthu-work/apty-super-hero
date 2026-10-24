// AI SDK
export { aisdk } from "@openai/agents-extensions/ai-sdk";
// Agent
export { AptyAgent } from "./agent/index.js";

// Config
export {
  AI_PROVIDERS,
  type AIProviderConfig,
  type AIProviderKey,
  type AppSettings,
  type AutomationMode,
  type CustomModelConfig,
  createConversationConfig,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CONVERSATION_CONFIG,
  detectProviderFromHost,
  isValidConversationStorage,
  type MigratedSettings,
  migrateSettings,
  normalizeConversationConfig,
  PHI_APPROVED_PROVIDERS,
  type ProviderType,
  REDACTION_MODES,
  type RedactionModeSetting,
  SCREENSHOT_POLICIES,
  type ScreenshotPolicySetting,
  SETTINGS_MIGRATIONS,
  SETTINGS_VERSION,
  type SettingsMigration,
  STORAGE_KEYS,
  type StorageKey,
  SUPERSEDED_PRESET_HOSTS,
  type ToolCallingSupport,
  validateAutomationMode,
  withSettingsDefaults,
} from "./config/index.js";

// Context
export { ContextManager } from "./context/manager.js";
export type {
  Context,
  ContextManagerOptions,
  ContextProvider,
  ContextProviderCapabilities,
  ContextQuery,
  ContextType,
} from "./context/types.js";
export {
  formatContextsForPrompt,
  isContext,
  resolveContexts,
} from "./context/utils.js";

// Conversation
export { ConversationCompressor } from "./conversation/compressor.js";
export { ConversationManager } from "./conversation/manager.js";
export { Session } from "./conversation/session.js";
export { SessionStorage } from "./conversation/storage.js";

// Generic Storage
export type {
  BaseKeyValueStorage,
  KeyValueStorage,
  WatchCallback,
} from "./storage/index.js";
export { InMemoryStorage } from "./storage/memory.js";

// Tools
export { calculatorTool } from "./tools/calculator.js";
export { httpFetchTool } from "./tools/http-fetch.js";
export { tool } from "./tools/index.js";
export {
  type ToolExecutionContext,
  type ToolMetadata,
  ToolRegistry,
  type UnifiedToolDefinition,
} from "./tools/registry.js";

// Types
export type {
  AfterResponsePayload,
  AgentEvent,
  AgentInputItem,
  AgentMetrics,
  AgentPlugin,
  AgentPluginContext,
  AgentPluginHooks,
  AiSdkModel,
  AptyAgentOptions,
  BeforeChatPayload,
  ChatOptions,
  CompressionConfig,
  CompressionOptions,
  ConversationConfig,
  ForkInfo,
  FunctionTool,
  ImageInput,
  MetricsPayload,
  OpenAIAgent,
  OutboundFilter,
  OutboundRequestContext,
  RequestReport,
  SerializedSession,
  SessionConfig,
  SessionStorageAdapter,
  SessionSummary,
  SessionTree,
  ToolEventPayload,
} from "./types.js";
export {
  CancellationError,
  CancellationToken,
} from "./utils/cancellation-token.js";
export type { ClassifiedLlmError } from "./utils/errors.js";
// Utils
export {
  AgentError,
  classifyLlmError,
  ErrorCode,
  LLMError,
  LLMStreamError,
  ToolError,
  ToolTimeoutError,
  TurnCancelledError,
} from "./utils/errors.js";
export { generateId } from "./utils/id-generator.js";
export { safeJsonParse } from "./utils/json.js";
export {
  createLogger,
  getLogLevel,
  type Logger,
  type LogLevel,
  setLogLevel,
} from "./utils/logger.js";
export {
  DEFAULT_RETENTION_MS,
  isExpired,
  type RetentionPolicy,
  selectForEviction,
} from "./utils/retention.js";
export { isTransientScreenshotItem } from "./utils/screenshot-shaping.js";
