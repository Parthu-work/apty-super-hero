import { conversationStorage } from "@apty/browser-runtime/conversation/conversation-storage";
import { clearAgentSessions } from "@apty/browser-runtime/storage/agent-session-store";
import { RuntimeScreenshotStorage } from "@apty/browser-runtime/storage/screenshot-storage";

/** Delete stored conversations, the agent's sessions and screenshots (Settings' purge, and the preflight page's "Reset demo data"). */
export async function purgeStoredData(): Promise<void> {
  await Promise.all([
    conversationStorage.clearAllConversations(),
    RuntimeScreenshotStorage.clearAll(),
    clearAgentSessions(),
  ]);
}
