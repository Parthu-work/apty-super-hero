/**
 * Message part types
 */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image"; imageData: string; imageTitle?: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

/**
 * UI Message structure
 */
export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  timestamp?: number;
}

/**
 * Conversation data structure stored in IndexedDB
 */
export interface ConversationData {
  id: string; // Conversation ID (e.g., "conv_1234567890_abc123")
  title: string; // Conversation title (generated from first user message)
  messages: UIMessage[]; // Message list (system messages filtered out)
  createdAt: number; // Creation timestamp
  updatedAt: number; // Last update timestamp
  /**
   * The `core.Session` id (from `@apty/agent-core`'s
   * `ConversationManager`) that holds this conversation's actual LLM
   * message history and tool-call state. `ConversationData.id` and this
   * field are two different id spaces — this field is what lets restoring
   * a conversation from history also rebind the live agent session to it,
   * instead of silently continuing whatever session happened to be active
   * (which would leak one conversation's agent state into another).
   */
  agentSessionId?: string;
}

/**
 * Conversation storage configuration
 */
export interface ConversationStorageConfig {
  maxConversations?: number; // Max conversations to keep (default: 5)
  dbName?: string; // IndexedDB database name
  storeName?: string; // IndexedDB store name
}
