import { createLogger } from "@apty/agent-core";
import type { ConversationData } from "./types";

const log = createLogger("ConversationMigration");

const OLD_STORAGE_KEY = "aipex-conversations";
const MIGRATION_FLAG_KEY = "aipex-conversations-migrated";

/**
 * Check if migration has already been completed
 */
export async function checkMigrationStatus(): Promise<boolean> {
  try {
    const flag = localStorage.getItem(MIGRATION_FLAG_KEY);
    return flag === "true";
  } catch {
    return false;
  }
}

/**
 * Mark migration as complete
 */
export async function markMigrationComplete(): Promise<void> {
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, "true");
    log.debug("✅ Migration marked as complete");
  } catch (error) {
    console.error("❌ [Migration] Failed to mark migration complete:", error);
  }
}

/**
 * Get old conversations from localStorage
 */
export async function getOldConversations(): Promise<ConversationData[]> {
  try {
    const oldData = localStorage.getItem(OLD_STORAGE_KEY);
    if (!oldData) {
      return [];
    }

    const parsed = JSON.parse(oldData);
    if (!Array.isArray(parsed)) {
      console.warn("⚠️ [Migration] Old data is not an array");
      return [];
    }

    return parsed as ConversationData[];
  } catch (error) {
    console.error("❌ [Migration] Failed to parse old conversations:", error);
    return [];
  }
}

/**
 * Remove old localStorage data
 */
export async function cleanupOldStorage(): Promise<void> {
  try {
    localStorage.removeItem(OLD_STORAGE_KEY);
    log.debug("🧹 Old localStorage data removed");
  } catch (error) {
    console.error("❌ [Migration] Failed to cleanup old storage:", error);
  }
}

/**
 * Perform full migration from localStorage to IndexedDB
 */
export async function migrate(
  saveCallback: (conversation: ConversationData) => Promise<void>,
): Promise<{ success: boolean; migratedCount: number }> {
  try {
    const alreadyMigrated = await checkMigrationStatus();
    if (alreadyMigrated) {
      log.debug("✅ Already migrated, skipping");
      return { success: true, migratedCount: 0 };
    }

    const oldConversations = await getOldConversations();
    if (oldConversations.length === 0) {
      log.debug("✅ No conversations to migrate");
      await markMigrationComplete();
      return { success: true, migratedCount: 0 };
    }

    log.debug(`🔄 Migrating ${oldConversations.length} conversation(s)...`);

    let migratedCount = 0;
    for (const conversation of oldConversations) {
      try {
        await saveCallback(conversation);
        migratedCount++;
      } catch (error) {
        console.error(
          `❌ [Migration] Failed to migrate conversation ${conversation.id}:`,
          error,
        );
      }
    }

    await markMigrationComplete();
    await cleanupOldStorage();

    log.debug(
      `✅ Successfully migrated ${migratedCount}/${oldConversations.length} conversation(s)`,
    );
    return { success: true, migratedCount };
  } catch (error) {
    console.error("❌ [Migration] Migration failed:", error);
    return { success: false, migratedCount: 0 };
  }
}
