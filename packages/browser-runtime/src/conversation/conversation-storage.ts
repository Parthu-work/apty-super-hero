import {
  createLogger,
  DEFAULT_RETENTION_MS,
  isExpired,
  selectForEviction,
} from "@apty/agent-core";
import {
  deleteAgentSessions,
  deleteOrphanAgentSessions,
} from "../storage/agent-session-store";
import { CONVERSATIONS_DB } from "../storage/database-names";
import { IndexedDBStorage } from "../storage/indexeddb-storage";
import { LRUPolicy } from "./lru-policy";
import { siteHostOf } from "./site-host";
import type {
  ConversationData,
  ConversationStorageConfig,
  UIMessage,
} from "./types";

const log = createLogger("ConversationStorage");

/**
 * Conversation Storage Manager
 * Manages conversation persistence using IndexedDB with LRU policy
 */
export class ConversationStorage {
  private readonly storage: IndexedDBStorage<ConversationData>;
  private readonly lruPolicy: LRUPolicy;
  private readonly config: Required<
    Omit<
      ConversationStorageConfig,
      "deleteAgentSessions" | "deleteOrphanAgentSessions"
    >
  >;
  private readonly deleteAgentSessions: (ids: string[]) => Promise<void>;
  private readonly deleteOrphanAgentSessions: (
    referenced: Set<string>,
  ) => Promise<string[]>;

  constructor(config: ConversationStorageConfig = {}) {
    this.config = {
      maxConversations: config.maxConversations ?? 5,
      maxAgeMs: config.maxAgeMs ?? DEFAULT_RETENTION_MS,
      dbName: config.dbName ?? CONVERSATIONS_DB,
      storeName: config.storeName ?? "conversations",
    };
    this.deleteAgentSessions =
      config.deleteAgentSessions ?? deleteAgentSessions;
    this.deleteOrphanAgentSessions =
      config.deleteOrphanAgentSessions ??
      ((referenced) => deleteOrphanAgentSessions(referenced));

    this.storage = new IndexedDBStorage<ConversationData>({
      dbName: this.config.dbName,
      storeName: this.config.storeName,
      version: 1,
      indexes: [{ name: "updatedAt", keyPath: "updatedAt", unique: false }],
    });

    this.lruPolicy = new LRUPolicy(this.config.maxConversations);
  }

  /**
   * Generate conversation title from messages
   */
  private generateTitle(messages: UIMessage[]): string {
    const firstUserMessage = messages.find((msg) => msg.role === "user");
    if (!firstUserMessage) {
      return "新对话";
    }

    const textPart = firstUserMessage.parts.find(
      (part) => part.type === "text",
    );
    if (textPart && "text" in textPart && textPart.text) {
      const text = textPart.text;
      return text.length > 30 ? `${text.slice(0, 30)}...` : text;
    }

    return "新对话";
  }

  /**
   * Filter out system messages
   */
  private filterMessages(messages: UIMessage[]): UIMessage[] {
    return messages.filter((msg) => msg.role !== "system");
  }

  /**
   * Apply LRU policy: delete oldest conversations if exceeding limit
   */
  private async applyLRU(): Promise<void> {
    try {
      const allConversations = await this.storage.listAll();
      const toDelete = selectForEviction(allConversations, {
        timeOf: (c) => c.updatedAt,
        maxItems: this.config.maxConversations,
        maxAgeMs: this.config.maxAgeMs,
      });

      if (toDelete.length > 0) {
        log.debug(`🗑️ LRU: Removing ${toDelete.length} old conversation(s)`);
        await Promise.all(toDelete.map((conv) => this.storage.delete(conv.id)));
        await this.removeAgentSessionsOf(toDelete);
      }
      const evicted = new Set(toDelete.map((c) => c.id));
      await this.sweepOrphanAgentSessions(
        allConversations.filter((c) => !evicted.has(c.id)),
      );
    } catch (error) {
      console.error("❌ [ConversationStorage] Failed to apply LRU:", error);
    }
  }

  /**
   * Save a new conversation
   * Returns the conversation ID. `siteHost` (from `siteHostOf`) is kept
   * only when it is a bare hostname.
   */
  async saveConversation(
    messages: UIMessage[],
    agentSessionId?: string,
    siteHost?: string,
  ): Promise<string> {
    if (messages.length === 0) {
      return "";
    }

    const messagesToSave = this.filterMessages(messages);
    if (messagesToSave.length === 0) {
      return "";
    }

    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    const title = this.generateTitle(messagesToSave);

    const conversation: ConversationData = {
      id: conversationId,
      title,
      messages: messagesToSave,
      createdAt: now,
      updatedAt: now,
      agentSessionId,
    };
    if (siteHost && siteHostOf(`https://${siteHost}/`) === siteHost) {
      conversation.siteHost = siteHost;
    }

    try {
      await this.storage.save(conversationId, conversation);
      await this.applyLRU();
      log.debug("💾 Conversation saved:", conversationId, title);
      return conversationId;
    } catch (error) {
      console.error(
        "❌ [ConversationStorage] Failed to save conversation:",
        error,
      );
      return "";
    }
  }

  /**
   * Get all conversations (sorted by updatedAt, most recent first)
   */
  /** Rejects when the stored chats can't be read, so the menu can say so. */
  async getAllConversations(): Promise<ConversationData[]> {
    await this.applyLRU();
    const conversations = await this.storage.listAll();
    return this.lruPolicy.sortByTimestamp(conversations);
  }

  /**
   * Get a single conversation by ID
   * Updates the conversation's updatedAt timestamp (LRU access tracking)
   */
  async getConversation(
    conversationId: string,
  ): Promise<ConversationData | null> {
    try {
      const conversation = await this.storage.load(conversationId);
      if (!conversation) {
        return null;
      }
      if (isExpired(conversation.updatedAt, this.config.maxAgeMs)) {
        await this.storage.delete(conversationId);
        await this.removeAgentSessionsOf([conversation]);
        return null;
      }

      // Update access time for LRU
      conversation.updatedAt = Date.now();
      await this.storage.save(conversationId, conversation);

      log.debug("🔄 Conversation access time updated:", conversationId);
      return conversation;
    } catch (error) {
      console.error(
        "❌ [ConversationStorage] Failed to get conversation:",
        error,
      );
      return null;
    }
  }

  /**
   * Update an existing conversation
   */
  async updateConversation(
    conversationId: string,
    messages: UIMessage[],
    agentSessionId?: string,
  ): Promise<void> {
    try {
      const conversation = await this.storage.load(conversationId);
      if (!conversation) {
        console.warn(
          "⚠️ [ConversationStorage] Conversation not found for update:",
          conversationId,
        );
        return;
      }

      const messagesToSave = this.filterMessages(messages);
      conversation.messages = messagesToSave;
      conversation.updatedAt = Date.now();
      if (agentSessionId) {
        conversation.agentSessionId = agentSessionId;
      }

      await this.storage.save(conversationId, conversation);
      log.debug("📝 Conversation updated:", conversationId);
    } catch (error) {
      console.error(
        "❌ [ConversationStorage] Failed to update conversation:",
        error,
      );
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string): Promise<void> {
    try {
      const conversation = await this.storage.load(conversationId);
      await this.storage.delete(conversationId);
      if (conversation) await this.removeAgentSessionsOf([conversation]);
      log.debug("🗑️ Conversation deleted:", conversationId);
    } catch (error) {
      console.error(
        "❌ [ConversationStorage] Failed to delete conversation:",
        error,
      );
    }
  }

  /**
   * Clear all conversations
   */
  async clearAllConversations(): Promise<void> {
    try {
      await this.storage.clear();
      log.debug("🧹 All conversations cleared");
    } catch (error) {
      console.error(
        "❌ [ConversationStorage] Failed to clear conversations:",
        error,
      );
    }
  }

  /** Agent sessions left by a panel closed without "New chat" (no saved conversation). */
  private async sweepOrphanAgentSessions(
    kept: ConversationData[],
  ): Promise<void> {
    const referenced = new Set(
      kept
        .map((c) => c.agentSessionId)
        .filter((id): id is string => Boolean(id)),
    );
    try {
      await this.deleteOrphanAgentSessions(referenced);
    } catch {
      log.warn("orphan_agent_session_sweep_failed");
    }
  }

  private async removeAgentSessionsOf(
    conversations: ConversationData[],
  ): Promise<void> {
    const ids = conversations
      .map((c) => c.agentSessionId)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return;
    try {
      await this.deleteAgentSessions(ids);
    } catch {
      log.warn("agent_session_delete_failed");
    }
  }

  /**
   * Close the storage (cleanup)
   */
  async close(): Promise<void> {
    await this.storage.close();
  }
}

// Export singleton instance
export const conversationStorage = new ConversationStorage();
