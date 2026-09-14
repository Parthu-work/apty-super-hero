import type {
  AgentInputItem,
  FunctionTool,
  Agent as OpenAIAgent,
} from "@openai/agents";
import type { AiSdkModel } from "@openai/agents-extensions";
import type { Context, ContextManager } from "./context/index.js";
import type { AgentError } from "./utils/errors.js";

// Re-export types from @openai/agents for convenient access
export type { FunctionTool, AiSdkModel, AgentInputItem, OpenAIAgent };

// ============================================================================
// Agent Types
// ============================================================================

export interface AIPexOptions<
  TTools extends readonly FunctionTool<any, any, any>[] = FunctionTool<
    any,
    any,
    any
  >[],
> {
  name?: string;
  instructions: string;
  /**
   * AI model to use. Create using aisdk() with a provider:
   *
   * @example
   * // OpenAI
   * import { openai } from '@ai-sdk/openai';
   * model: aisdk(openai('gpt-4o'))
   *
   * // Anthropic Claude
   * import { anthropic } from '@ai-sdk/anthropic';
   * model: aisdk(anthropic('claude-sonnet-4-20250514'))
   *
   * // Google Gemini
   * import { google } from '@ai-sdk/google';
   * model: aisdk(google('gemini-2.5-flash'))
   *
   * // OpenRouter
   * import { createOpenRouter } from '@openrouter/ai-sdk-provider';
   * const openRouter = createOpenRouter();
   * model: aisdk(openRouter('openai/gpt-4o'))
   */
  model: AiSdkModel;
  /**
   * Identifier of the model passed to `model` (e.g. `settings.aiModel`).
   *
   * Used only to isolate provider-specific reasoning metadata: a "reasoning"
   * item replayed from a previous turn is forwarded to the model only when
   * it was produced by this same model id AND that model/provider is known
   * to actually support reasoning replay — see
   * `utils/model-input-sanitizer.ts`. Omitting it means reasoning items are
   * never replayed, which is always safe, just more conservative.
   */
  modelId?: string;
  /**
   * The provider key behind `model` (e.g. `settings.aiProvider` — "openai",
   * "groq", "deepseek", "anthropic", ...).
   *
   * Used only to decide whether a "reasoning" item is safe to replay at
   * all: most OpenAI-compatible providers (Groq included) reject an
   * incoming assistant message carrying `reasoning_content` outright, even
   * when it was produced by that exact same model — same-model matching
   * alone is not a safe signal. See `utils/model-input-sanitizer.ts`.
   * Omitting it means reasoning items are never replayed.
   */
  modelProvider?: string;
  tools?: TTools;
  maxTurns?: number;

  /**
   * Disable conversation management (stateless mode).
   * When false, no session will be created or maintained.
   */
  conversation?: false;

  /**
   * Custom storage adapter for sessions.
   * Defaults to SessionStorage with InMemoryStorage if not provided.
   */
  storage?: SessionStorageAdapter;

  /**
   * Compression configuration for long conversations.
   * Requires a model for generating summaries.
   */
  compression?: CompressionOptions;

  /**
   * Fully custom ConversationManager instance.
   * When provided, storage and compression options are ignored.
   */
  conversationManager?: import("./conversation/manager.js").ConversationManager;

  /**
   * Context manager for providing additional context to the agent.
   * Contexts can come from various sources (browser, filesystem, database, etc.)
   */
  contextManager?: ContextManager;
  /**
   * Optional runtime plugins that can observe conversations.
   */
  plugins?: AgentPlugin[];
}

export interface CompressionOptions extends CompressionConfig {
  model: AiSdkModel;
}

export interface ImageInput {
  /** base64-encoded image data, a URL, or a file ID */
  image: string;
  /** Vision detail level. Defaults to "auto". */
  detail?: "auto" | "low" | "high";
}

export interface ChatOptions {
  sessionId?: string;
  /**
   * Contexts to include with this message.
   * Can be Context objects or context IDs (strings).
   * Context IDs will be resolved using the ContextManager.
   */
  contexts?: Context[] | string[];
  /**
   * Images to include with this message.
   * When provided, the text input and images are combined into a
   * multimodal UserMessageItem sent to the model's vision path.
   */
  images?: ImageInput[];
  /**
   * Opaque per-conversation execution context, forwarded verbatim to
   * `@openai/agents`'s `run()` as its `context` option and therefore made
   * available to every tool's `execute(input, context)` as
   * `context.context`. `core` does not interpret this value — the runtime
   * (e.g. `@aipexstudio/browser-runtime`) defines its own shape (typically
   * a conversation id plus a bound tab id) so that tools can resolve
   * "which browser tab is this conversation about" instead of guessing at
   * whichever tab happens to be focused when the tool runs.
   */
  runContext?: unknown;
  /**
   * Override the tool set exposed to the model for this single turn only —
   * the agent's own default tools (from `AIPexOptions.tools`) are
   * unaffected and used again on the next call unless overridden again.
   * Lets a runtime with a large tool registry keep every tool registered
   * while only sending the subset relevant to the current request in the
   * model's tool schema (smaller request, same capabilities). Omit to use
   * the agent's default tools.
   */
  tools?: FunctionTool[];
}

export interface AgentMetrics {
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  itemCount: number;
  maxTurns: number;
  duration: number;
  startTime: number;
}

export type AgentEvent =
  | { type: "session_created"; sessionId: string }
  | { type: "session_resumed"; sessionId: string; itemCount: number }
  | { type: "content_delta"; delta: string }
  | { type: "tool_call_args_streaming_start"; toolName: string }
  | {
      type: "tool_call_args_streaming_complete";
      toolName: string;
      params: unknown;
    }
  | { type: "tool_call_start"; toolName: string; params: unknown }
  | { type: "tool_call_complete"; toolName: string; result: unknown }
  | { type: "tool_call_error"; toolName: string; error: Error }
  | { type: "contexts_attached"; contexts: Context[] }
  | { type: "contexts_loaded"; providerId: string; count: number }
  | { type: "context_error"; providerId: string; error: Error }
  | { type: "metrics_update"; metrics: AgentMetrics; sessionId?: string }
  | { type: "error"; error: AgentError }
  | {
      type: "execution_complete";
      finalOutput: string;
      metrics: AgentMetrics;
    };

// ============================================================================
// Plugin Types
// ============================================================================

export interface BeforeChatPayload {
  input: string | AgentInputItem[];
  options?: ChatOptions;
  contexts?: Context[];
}

export interface AfterResponsePayload {
  input: string | AgentInputItem[];
  finalOutput: string;
  metrics: AgentMetrics;
  sessionId?: string;
}

export interface ToolEventPayload {
  event: AgentEvent;
}

export interface MetricsPayload {
  metrics: AgentMetrics;
  sessionId?: string;
}

export interface AgentPluginContext {
  agent: import("./agent/aipex.js").AIPex;
}

export interface AgentPluginHooks {
  beforeChat?: (
    payload: BeforeChatPayload,
    ctx: AgentPluginContext,
  ) => Promise<BeforeChatPayload | undefined> | BeforeChatPayload | undefined;
  afterResponse?: (
    payload: AfterResponsePayload,
    ctx: AgentPluginContext,
  ) => Promise<void> | void;
  onToolEvent?: (
    payload: ToolEventPayload,
    ctx: AgentPluginContext,
  ) => Promise<void> | void;
  onMetrics?: (
    payload: MetricsPayload,
    ctx: AgentPluginContext,
  ) => Promise<void> | void;
}

export interface AgentPlugin {
  id: string;
  setup?: (ctx: AgentPluginContext) => Promise<void> | void;
  hooks?: AgentPluginHooks;
}

// ============================================================================
// Session Types
// ============================================================================

export interface SessionConfig {
  systemPrompt?: string;
}

export interface ForkInfo {
  parentSessionId?: string;
  forkAtItemIndex?: number;
}

export interface SessionMetrics {
  totalTokensUsed: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  executionCount: number;
}

export interface SerializedSession {
  id: string;
  items: AgentInputItem[];
  metadata: Record<string, unknown>;
  config: SessionConfig;
  metrics: SessionMetrics;
  parentSessionId?: string;
  forkAtItemIndex?: number;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface SessionSummary {
  id: string;
  preview: string;
  createdAt: number;
  lastActiveAt: number;
  itemCount?: number;
  tags?: string[];
  parentSessionId?: string;
  forkAtItemIndex?: number;
}

export interface SessionTree {
  session: SessionSummary;
  children: SessionTree[];
}

export interface SessionStorageAdapter {
  save(session: import("./conversation/session.js").Session): Promise<void>;
  load(id: string): Promise<import("./conversation/session.js").Session | null>;
  delete(id: string): Promise<void>;
  listAll(): Promise<SessionSummary[]>;
  getSessionTree(rootId?: string): Promise<SessionTree[]>;
  getChildren(parentId: string): Promise<SessionSummary[]>;
}

// ============================================================================
// Config Types
// ============================================================================

export interface ConversationConfig {
  enabled?: boolean;
  storage?: "memory" | "indexeddb";
}

export interface CompressionConfig {
  summarizeAfterItems?: number;
  keepRecentItems?: number;
  maxSummaryLength?: number;
  /**
   * Token watermark threshold. If set and lastPromptTokens exceeds this value,
   * compression will be triggered automatically.
   * Example: 150000
   */
  tokenWatermark?: number;
  /**
   * Number of recent messages (type="message") to protect from compression.
   * When set, the compressor will keep the last N message items and their
   * associated tool call/result pairs intact, and only compress older items.
   */
  protectRecentMessages?: number;
}
