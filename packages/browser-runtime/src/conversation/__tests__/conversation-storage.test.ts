import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationData, UIMessage } from "../types";

// Shared in-memory backing store for the mocked IndexedDBStorage below, so
// tests can verify what was actually persisted (e.g. `agentSessionId`)
// instead of only that `save` was called. Reset in `beforeEach`. Declared
// via `vi.hoisted` because `vi.mock` factories run before normal top-level
// statements in this file.
const { mockDb } = vi.hoisted(() => ({
  mockDb: {} as Record<string, ConversationData>,
}));

// Mock IndexedDBStorage before importing ConversationStorage
vi.mock("../../storage/indexeddb-storage", () => ({
  IndexedDBStorage: class MockIndexedDBStorage {
    save = vi.fn(async (id: string, value: ConversationData) => {
      mockDb[id] = value;
    });
    load = vi.fn(async (id: string) => mockDb[id] ?? null);
    delete = vi.fn(async (id: string) => {
      delete mockDb[id];
    });
    list = vi.fn().mockResolvedValue([]);
    listAll = vi.fn(async () => Object.values(mockDb));
    clear = vi.fn().mockResolvedValue(undefined);
    watch = vi.fn().mockReturnValue(() => {});
  },
}));

// Import after mocks are set up
import { ConversationStorage } from "../conversation-storage";
import { siteHostOf } from "../site-host";

describe("ConversationStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockDb)) {
      delete mockDb[key];
    }
  });

  const createMockMessages = (count: number = 3): UIMessage[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `msg${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      parts: [{ type: "text" as const, text: `Message ${i}` }],
      timestamp: Date.now() + i * 1000,
    }));
  };

  describe("generateTitle", () => {
    it("should generate title from first user message", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello, how are you?" }],
        },
      ];

      // Access private method through type assertion for testing
      const title = (storage as any).generateTitle(messages);

      expect(title).toBe("Hello, how are you?");
    });

    it("should truncate long titles", () => {
      const storage = new ConversationStorage();
      const longText = "a".repeat(50);
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: longText }],
        },
      ];

      const title = (storage as any).generateTitle(messages);

      expect(title).toHaveLength(33); // 30 chars + "..."
      expect(title).toMatch(/^a+\.\.\.$/);
    });

    it("should return default title when no user message", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      const title = (storage as any).generateTitle(messages);

      expect(title).toBe("新对话");
    });

    it("should return default title when user message has no text", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "image", imageData: "data:image/png;base64,..." }],
        },
      ];

      const title = (storage as any).generateTitle(messages);

      expect(title).toBe("新对话");
    });
  });

  describe("filterMessages", () => {
    it("should filter out system messages", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "system",
          parts: [{ type: "text", text: "System message" }],
        },
        {
          id: "2",
          role: "user",
          parts: [{ type: "text", text: "User message" }],
        },
        {
          id: "3",
          role: "assistant",
          parts: [{ type: "text", text: "Assistant message" }],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);

      expect(filtered).toHaveLength(2);
      expect(
        filtered.find((m: UIMessage) => m.role === "system"),
      ).toBeUndefined();
    });

    it("should keep user and assistant messages", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "User message" }],
        },
        {
          id: "2",
          role: "assistant",
          parts: [{ type: "text", text: "Assistant message" }],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);

      expect(filtered).toHaveLength(2);
      expect(filtered).toEqual(messages);
    });
  });

  describe("configuration", () => {
    it("should use default configuration", () => {
      const storage = new ConversationStorage();

      expect((storage as any).config.maxConversations).toBe(5);
      expect((storage as any).config.dbName).toBe("apty-conversations-db");
      expect((storage as any).config.storeName).toBe("conversations");
    });

    it("should accept custom configuration", () => {
      const storage = new ConversationStorage({
        maxConversations: 10,
        dbName: "custom-db",
        storeName: "custom-store",
      });

      expect((storage as any).config.maxConversations).toBe(10);
      expect((storage as any).config.dbName).toBe("custom-db");
      expect((storage as any).config.storeName).toBe("custom-store");
    });

    it("should use defaults for missing config values", () => {
      const storage = new ConversationStorage({
        maxConversations: 10,
      });

      expect((storage as any).config.maxConversations).toBe(10);
      expect((storage as any).config.dbName).toBe("apty-conversations-db");
      expect((storage as any).config.storeName).toBe("conversations");
    });
  });

  describe("retention", () => {
    const DAY = 24 * 60 * 60 * 1000;

    function stored(id: string, ageDays: number): ConversationData {
      const updatedAt = Date.now() - ageDays * DAY;
      mockDb[id] = {
        id,
        title: id,
        messages: createMockMessages(2),
        createdAt: updatedAt,
        updatedAt,
      } as ConversationData;
      return mockDb[id];
    }

    it("deletes conversations unused for longer than the retention period when listing", async () => {
      stored("fresh", 1);
      stored("stale", 8);
      const storage = new ConversationStorage();

      const ids = (await storage.getAllConversations()).map((c) => c.id);

      expect(ids).toEqual(["fresh"]);
      expect(mockDb.stale).toBeUndefined();
    });

    it("does not reopen an expired conversation", async () => {
      stored("stale", 30);
      const storage = new ConversationStorage();

      expect(await storage.getConversation("stale")).toBeNull();
      expect(mockDb.stale).toBeUndefined();
    });

    it("honours a custom retention period", async () => {
      stored("two-days", 2);
      const storage = new ConversationStorage({ maxAgeMs: DAY });

      expect(await storage.getAllConversations()).toEqual([]);
    });
  });

  describe("siteHost", () => {
    it("keeps the host the chat was first saved on, and an update never changes it", async () => {
      const storage = new ConversationStorage();
      const id = await storage.saveConversation(
        createMockMessages(2),
        undefined,
        siteHostOf("https://app.example.com/orders/42?token=abc#x"),
      );

      expect(mockDb[id]?.siteHost).toBe("app.example.com");

      await storage.updateConversation(id, createMockMessages(4));
      expect(mockDb[id]?.siteHost).toBe("app.example.com");
    });

    it("is absent for a page that is not http(s), and on a chat saved before it existed", async () => {
      const storage = new ConversationStorage();
      const id = await storage.saveConversation(
        createMockMessages(2),
        undefined,
        siteHostOf("chrome://extensions/"),
      );
      mockDb.old = { ...mockDb[id]!, id: "old" };
      delete mockDb.old.siteHost;
      await storage.updateConversation("old", createMockMessages(4));

      expect(mockDb[id]).not.toHaveProperty("siteHost");
      expect(mockDb.old).not.toHaveProperty("siteHost");
    });

    it("never stores anything but a bare hostname", async () => {
      const storage = new ConversationStorage();
      for (const host of [
        "app.example.com/orders",
        "app.example.com?q=1",
        "https://app.example.com",
        "user@app.example.com",
      ]) {
        const id = await storage.saveConversation(
          createMockMessages(2),
          undefined,
          host,
        );
        expect(mockDb[id]).not.toHaveProperty("siteHost");
      }
    });
  });

  describe("getAllConversations", () => {
    it("rejects when the stored chats can't be read", async () => {
      const storage = new ConversationStorage();
      const listAll = vi
        .spyOn(
          (storage as unknown as { storage: { listAll: () => unknown } })
            .storage,
          "listAll",
        )
        .mockRejectedValue(new Error("database closed"));

      await expect(storage.getAllConversations()).rejects.toThrow(
        "database closed",
      );
      listAll.mockRestore();
    });
  });

  describe("saveConversation", () => {
    it("should return empty string for empty messages", async () => {
      const storage = new ConversationStorage();
      const conversationId = await storage.saveConversation([]);

      expect(conversationId).toBe("");
    });

    it("should return empty string when all messages are system messages", async () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "system",
          parts: [{ type: "text", text: "System message" }],
        },
      ];

      const conversationId = await storage.saveConversation(messages);

      expect(conversationId).toBe("");
    });

    it("should generate conversation ID with correct format", async () => {
      const storage = new ConversationStorage();
      const messages = createMockMessages(2);

      const conversationId = await storage.saveConversation(messages);

      expect(conversationId).toMatch(/^conv_\d+_[a-z0-9]+$/);
    });
  });

  describe("orphan agent sessions", () => {
    it("sweeps after a save, keeping every session a saved conversation points to", async () => {
      const deleteOrphanAgentSessions = vi.fn(async () => []);
      const storage = new ConversationStorage({ deleteOrphanAgentSessions });

      await storage.saveConversation(createMockMessages(), "session-a");
      await storage.saveConversation(createMockMessages(), "session-b");
      await storage.saveConversation(createMockMessages());

      expect(deleteOrphanAgentSessions).toHaveBeenLastCalledWith(
        new Set(["session-a", "session-b"]),
      );
    });

    it("still saves the conversation when the sweep fails", async () => {
      const storage = new ConversationStorage({
        deleteOrphanAgentSessions: vi.fn(async () => {
          throw new Error("idb closed");
        }),
      });

      const id = await storage.saveConversation(createMockMessages(), "s");

      expect(mockDb[id]?.agentSessionId).toBe("s");
    });
  });

  describe("agentSessionId — reconciling UI conversations with agent sessions", () => {
    // `ConversationData.id` (this store's key) and the `core.Session.id`
    // that actually holds the LLM message history are two different id
    // spaces. Without persisting which agent session a conversation owns,
    // restoring a past conversation from history has no way to rebind the
    // live agent session to it — the next message would silently continue
    // whatever session was previously active, leaking one conversation's
    // agent state into another's UI. `agentSessionId` is what closes that
    // gap; these tests guard its persistence.
    it("persists agentSessionId when saving a new conversation", async () => {
      const storage = new ConversationStorage();
      const messages = createMockMessages(2);

      const conversationId = await storage.saveConversation(
        messages,
        "core-session-abc",
      );

      const stored = await storage.getConversation(conversationId);
      expect(stored?.agentSessionId).toBe("core-session-abc");
    });

    it("leaves agentSessionId undefined when not provided", async () => {
      const storage = new ConversationStorage();
      const messages = createMockMessages(2);

      const conversationId = await storage.saveConversation(messages);

      const stored = await storage.getConversation(conversationId);
      expect(stored?.agentSessionId).toBeUndefined();
    });

    it("updates agentSessionId on an existing conversation", async () => {
      const storage = new ConversationStorage();
      const messages = createMockMessages(2);
      const conversationId = await storage.saveConversation(
        messages,
        "core-session-abc",
      );

      await storage.updateConversation(
        conversationId,
        createMockMessages(3),
        "core-session-xyz",
      );

      const stored = await storage.getConversation(conversationId);
      expect(stored?.agentSessionId).toBe("core-session-xyz");
    });

    it("does not clear an existing agentSessionId when updating without one", async () => {
      const storage = new ConversationStorage();
      const messages = createMockMessages(2);
      const conversationId = await storage.saveConversation(
        messages,
        "core-session-abc",
      );

      await storage.updateConversation(conversationId, createMockMessages(3));

      const stored = await storage.getConversation(conversationId);
      expect(stored?.agentSessionId).toBe("core-session-abc");
    });
  });

  describe("agent sessions follow their conversation", () => {
    const DAY = 24 * 60 * 60 * 1000;

    function storedWithSession(id: string, ageDays: number, session?: string) {
      const updatedAt = Date.now() - ageDays * DAY;
      mockDb[id] = {
        id,
        title: id,
        messages: createMockMessages(2),
        createdAt: updatedAt,
        updatedAt,
        agentSessionId: session,
      } as ConversationData;
    }

    it("deletes the agent session when a conversation is deleted", async () => {
      storedWithSession("c1", 0, "s1");
      const deleteAgentSessions = vi.fn().mockResolvedValue(undefined);
      const storage = new ConversationStorage({ deleteAgentSessions });

      await storage.deleteConversation("c1");

      expect(mockDb.c1).toBeUndefined();
      expect(deleteAgentSessions).toHaveBeenCalledWith(["s1"]);
    });

    it("does not call the session store for a conversation without a session", async () => {
      storedWithSession("c1", 0);
      const deleteAgentSessions = vi.fn().mockResolvedValue(undefined);
      const storage = new ConversationStorage({ deleteAgentSessions });

      await storage.deleteConversation("c1");

      expect(deleteAgentSessions).not.toHaveBeenCalled();
    });

    it("evicts the sessions of conversations removed by age or count", async () => {
      storedWithSession("old", 8, "s-old");
      for (let i = 0; i < 6; i++) storedWithSession(`c${i}`, i * 0.1, `s${i}`);
      const deleteAgentSessions = vi.fn().mockResolvedValue(undefined);
      const storage = new ConversationStorage({ deleteAgentSessions });

      await storage.getAllConversations();

      const evicted = deleteAgentSessions.mock.calls.flatMap(([ids]) => ids);
      expect(evicted.sort()).toEqual(["s-old", "s5"]);
      expect(Object.keys(mockDb).sort()).toEqual([
        "c0",
        "c1",
        "c2",
        "c3",
        "c4",
      ]);
    });

    it("deletes the session of an expired conversation that is opened", async () => {
      storedWithSession("stale", 30, "s-stale");
      const deleteAgentSessions = vi.fn().mockResolvedValue(undefined);
      const storage = new ConversationStorage({ deleteAgentSessions });

      expect(await storage.getConversation("stale")).toBeNull();
      expect(deleteAgentSessions).toHaveBeenCalledWith(["s-stale"]);
    });

    it("still deletes the conversation when the session store fails", async () => {
      storedWithSession("c1", 0, "s1");
      const deleteAgentSessions = vi.fn().mockRejectedValue(new Error("x"));
      const storage = new ConversationStorage({ deleteAgentSessions });

      await storage.deleteConversation("c1");

      expect(mockDb.c1).toBeUndefined();
    });
  });

  describe("message types", () => {
    it("should handle text messages", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);
      expect(filtered).toHaveLength(1);
    });

    it("should handle image messages", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [
            {
              type: "image",
              imageData: "data:image/png;base64,...",
              imageTitle: "Screenshot",
            },
          ],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);
      expect(filtered).toHaveLength(1);
    });

    it("should handle tool_use messages", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: "tool_use",
              id: "tool1",
              name: "search",
              input: { query: "test" },
            },
          ],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);
      expect(filtered).toHaveLength(1);
    });

    it("should handle tool_result messages", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [
            {
              type: "tool_result",
              tool_use_id: "tool1",
              content: "Result",
              is_error: false,
            },
          ],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);
      expect(filtered).toHaveLength(1);
    });

    it("should handle mixed message parts", () => {
      const storage = new ConversationStorage();
      const messages: UIMessage[] = [
        {
          id: "1",
          role: "user",
          parts: [
            { type: "text", text: "Check this image:" },
            { type: "image", imageData: "data:image/png;base64,..." },
          ],
        },
      ];

      const filtered = (storage as any).filterMessages(messages);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].parts).toHaveLength(2);
    });
  });
});
