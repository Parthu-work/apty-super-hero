import type { AgentMetrics, FunctionTool } from "@apty/agent-core";
import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import type {
  ChatStatus,
  ContextItem,
  UIMessage,
  UIToolPart,
  WelcomeSuggestion,
} from "./ui";

// ============ Chat Configuration ============

export type AIProvider = "openai" | "anthropic" | "google";

export interface ChatConfig {
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Maximum number of turns before stopping */
  maxTurns?: number;
  /** Temperature for LLM responses */
  temperature?: number;
  /** Maximum tokens for LLM responses */
  maxTokens?: number;
  /** Initial messages to display */
  initialMessages?: UIMessage[];
  /**
   * Resolve the opaque per-conversation execution context forwarded to
   * `AIPex.chat()` as `ChatOptions.runContext` before every send. Runtimes
   * that bind a conversation to a specific browser tab (e.g.
   * `@apty/browser-runtime`) use this to tell tool calls which tab
   * this conversation is actually about, keeping `@apty/ui` itself
   * runtime-agnostic. Called with the current session id (`null` before
   * the first message creates one).
   */
  getRunContext?: (sessionId: string | null) => unknown | Promise<unknown>;
  /**
   * Choose which tools to expose to the model for this specific message,
   * out of the runtime's full tool registry. Runtimes with a large tool
   * registry (e.g. `@apty/browser-runtime`) use this to keep every
   * tool available while only sending the ones relevant to the current
   * request in the model's tool schema, instead of always sending the
   * entire registry. Returning `undefined` (or omitting this callback)
   * falls back to the agent's default tool set.
   */
  selectTools?: (
    text: string,
    sessionId: string | null,
  ) => FunctionTool[] | undefined | Promise<FunctionTool[] | undefined>;
}

// ============ Component Props Types ============

export interface MessageListProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onCopy"> {
  messages: UIMessage[];
  status: ChatStatus;
  onRegenerate?: () => void;
  onCopy?: (text: string) => void;
}

export interface MessageItemProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onCopy"> {
  message: UIMessage;
  isLast?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onCopy?: (text: string) => void;
}

export interface InputAreaProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "onSubmit"> {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string, files?: File[], contexts?: ContextItem[]) => void;
  onStop?: () => void;
  status: ChatStatus;
  placeholder?: string;
  disabled?: boolean;
}

export interface WelcomeScreenProps extends HTMLAttributes<HTMLDivElement> {
  onSuggestionClick: (text: string) => void;
  /** Handler for the UX audit suggestion; when provided, clicking that suggestion opens the audit dialog instead of sending the text directly. */
  onUxAuditClick?: () => void;
  suggestions?: WelcomeSuggestion[];
}

export interface HeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  onSettingsClick?: () => void;
  onNewChat?: () => void;
}

export interface FooterProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

// ============ Slot Props Types ============

export interface MessageActionsSlotProps {
  message: UIMessage;
  onRegenerate?: () => void;
  onCopy?: (text: string) => void;
}

export interface InputToolbarSlotProps {
  status: ChatStatus;
  onStop?: () => void;
  onSubmit?: () => void;
}

export interface ModelSelectorSlotProps {
  value?: string;
  onChange?: (value: string) => void;
  models?: Array<{ name: string; value: string }>;
}

export interface ContextTagsSlotProps {
  contexts: ContextItem[];
  onRemove?: (id: string) => void;
}

export interface ToolDisplaySlotProps {
  tool: UIToolPart;
}

// ============ Slots Configuration ============

export interface ChatbotSlots {
  /** Custom message actions (regenerate, copy, etc.) */
  messageActions?: (props: MessageActionsSlotProps) => ReactNode;
  /** Custom input toolbar */
  inputToolbar?: (props: InputToolbarSlotProps) => ReactNode;
  /** Custom model selector */
  modelSelector?: (props: ModelSelectorSlotProps) => ReactNode;
  /** Custom context tags display */
  contextTags?: (props: ContextTagsSlotProps) => ReactNode;
  /** Custom tool display */
  toolDisplay?: (props: ToolDisplaySlotProps) => ReactNode;
  /** Custom header content */
  headerContent?: () => ReactNode;
  /** Custom footer content */
  footerContent?: () => ReactNode;
  /** Custom empty state / welcome screen */
  emptyState?: (props: WelcomeScreenProps) => ReactNode;
  /** Custom loading indicator */
  loadingIndicator?: () => ReactNode;
  /** Content to render before all messages (e.g., update banners, announcements) */
  beforeMessages?: () => ReactNode;
  /** Content to render after all messages (for platform-specific features like interventions) */
  afterMessages?: () => ReactNode;
  /** Extra content rendered inside PromptInput (e.g., context/skill loaders) */
  promptExtras?: () => ReactNode;
  /** Handler called when user clicks Login in a LoginPrompt inside a message */
  onLogin?: () => void;
}

// ============ Components Configuration ============

export interface ChatbotComponents {
  /** Replace the entire message list */
  MessageList?: ComponentType<MessageListProps>;
  /** Replace individual message items */
  MessageItem?: ComponentType<MessageItemProps>;
  /** Replace the input area */
  InputArea?: ComponentType<InputAreaProps>;
  /** Replace the welcome screen */
  WelcomeScreen?: ComponentType<WelcomeScreenProps>;
  /** Replace the header */
  Header?: ComponentType<HeaderProps>;
  /** Replace the footer */
  Footer?: ComponentType<FooterProps>;
}

// ============ Theme Types ============

export interface ChatbotTheme {
  /** CSS class name for the root container */
  className?: string;
  /** CSS variables for theming */
  variables?: ChatbotThemeVariables;
}

export interface ChatbotThemeVariables {
  /** Primary color */
  "--chatbot-primary"?: string;
  /** Primary foreground color */
  "--chatbot-primary-foreground"?: string;
  /** Secondary color */
  "--chatbot-secondary"?: string;
  /** Secondary foreground color */
  "--chatbot-secondary-foreground"?: string;
  /** Background color */
  "--chatbot-background"?: string;
  /** Foreground color */
  "--chatbot-foreground"?: string;
  /** Muted color */
  "--chatbot-muted"?: string;
  /** Muted foreground color */
  "--chatbot-muted-foreground"?: string;
  /** Border color */
  "--chatbot-border"?: string;
  /** Border radius */
  "--chatbot-radius"?: string;
  /** User message background */
  "--chatbot-user-bg"?: string;
  /** User message text color */
  "--chatbot-user-fg"?: string;
  /** Assistant message background */
  "--chatbot-assistant-bg"?: string;
  /** Assistant message text color */
  "--chatbot-assistant-fg"?: string;
  /** Custom CSS variables */
  [key: `--chatbot-${string}`]: string | undefined;
}

// ============ Event Handlers ============

/** Result of a pre-flight auth check before sending a message */
export interface AuthCheckResult {
  /** Whether the user needs to authenticate */
  needsAuth: boolean;
  /** Whether the user has a custom BYOK configuration */
  hasCustomConfig: boolean;
}

export interface ChatbotEventHandlers {
  /** Called when a message is sent */
  onMessageSent?: (message: UIMessage) => void;
  /** Called when a response is received */
  onResponseReceived?: (message: UIMessage) => void;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Called when status changes */
  onStatusChange?: (status: ChatStatus) => void;
  /** Called when a tool is executed */
  onToolExecute?: (toolName: string, input: unknown) => void;
  /** Called when a tool completes */
  onToolComplete?: (toolName: string, result: unknown) => void;
  /** Called when metrics are updated */
  onMetricsUpdate?: (metrics: AgentMetrics, sessionId?: string) => void;
  /**
   * Pre-flight auth check called before sending a message.
   * If this returns `{ needsAuth: true }`, the chatbot will display a
   * LoginPrompt inline instead of sending the message.
   */
  checkAuthBeforeSend?: () => Promise<AuthCheckResult>;
}

// Re-export AgentMetrics for convenience
export type { AgentMetrics } from "@apty/agent-core";
