/**
 * Non-React utilities and storage adapters
 * Safe to import from any context (background, content, React components)
 */

import { chromeStorageAdapter } from "@apty/browser-runtime";
import { effectiveSettingsStorage } from "@apty/browser-runtime/runtime/effective-settings";

/**
 * chrome.storage.local for the settings UI and the chat, with the settings
 * key read as the effective settings (KB-RAG K22, S2): the organization
 * policy applied, and a write to a locked field ignored.
 */
export const settingsStorageAdapter =
  effectiveSettingsStorage(chromeStorageAdapter);

/**
 * React hooks should be imported directly from their sources:
 * - useAgent, useChat, useChatConfig, useTheme from "@apty/ui"
 * - useStorage from "@apty/browser-runtime/hooks"
 * - useTabsSync from "./use-tabs-sync.js"
 */
