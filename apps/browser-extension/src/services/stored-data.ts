import { conversationStorage } from "@apty/browser-runtime/conversation/conversation-storage";
import { RuntimeScreenshotStorage } from "@apty/browser-runtime/storage/screenshot-storage";

/** Delete stored conversations and screenshots (Settings' purge, and the preflight page's "Reset demo data"). */
export async function purgeStoredData(): Promise<void> {
  await Promise.all([
    conversationStorage.clearAllConversations(),
    RuntimeScreenshotStorage.clearAll(),
  ]);
}
