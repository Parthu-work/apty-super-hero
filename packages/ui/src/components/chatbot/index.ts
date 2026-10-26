// Main component exports

// Re-export from top-level modules
export { ChatAdapter, createChatAdapter } from "../../adapters/chat-adapter";
export { useChat, useChatConfig } from "../../hooks";
export type {
  AppSettings,
  ChatbotComponents,
  ChatbotEventHandlers,
  ChatbotSlots,
  ChatbotTheme,
  ChatbotThemeVariables,
  ChatConfig,
  ChatStatus,
  ContextItem,
  ContextItemType,
  ContextTagsSlotProps,
  FooterProps,
  HeaderProps,
  InputAreaProps,
  InputToolbarSlotProps,
  MessageActionsSlotProps,
  MessageItemProps,
  MessageListProps,
  ModelSelectorSlotProps,
  ToolDisplaySlotProps,
  UIContextPart,
  UIFilePart,
  UIMessage,
  UIPart,
  UIReasoningPart,
  UIRole,
  UISourceUrlPart,
  UITextPart,
  UIToolPart,
  UIToolState,
  WelcomeScreenProps,
} from "../../types";
// Individual component exports
export {
  DefaultHeader,
  DefaultInputArea,
  DefaultMessageItem,
  DefaultMessageList,
  type ExtendedInputAreaProps,
  Header,
  InputArea,
  MessageItem,
  MessageList,
  TokenUsageIndicator,
  type TokenUsageIndicatorProps,
  WelcomeScreen,
} from "./components";
// Default export for backward compatibility
export {
  Chatbot,
  Chatbot as default,
  type ChatbotProps,
  ChatbotProvider,
} from "./components/chatbot";
// Slot component exports
export {
  CompactContextTags,
  CompactModelSelector,
  ContextTag,
  DefaultContextTags,
  DefaultInputToolbar,
  DefaultMessageActions,
  DefaultModelSelector,
  DefaultToolDisplay,
  InputToolbarWithLabel,
  MessageActionsWithFeedback,
} from "./components/slots";
export { SYSTEM_PROMPT } from "./constants";
// Context exports
export {
  AgentContext,
  type AgentContextValue,
  type ChatbotProviderProps,
  type ChatbotStyleContextValue,
  ChatContext,
  type ChatContextValue,
  ComponentsContext,
  type ComponentsContextValue,
  ConfigContext,
  type ConfigContextValue,
  ThemeContext,
  useAgentContext,
  useChatbotStyleContext,
  useChatContext,
  useComponentsContext,
  useConfigContext,
  useThemeContext,
} from "./context";
