/**
 * Non-React utilities and storage adapters
 * Safe to import from any context (background, content, React components)
 */

// Re-export storage adapter (no React dependency)
export { chromeStorageAdapter } from "@apty/browser-runtime";

/**
 * React hooks should be imported directly from their sources:
 * - useAgent, useChat, useChatConfig, useTheme from "@apty/ui"
 * - useStorage from "@apty/browser-runtime/hooks"
 * - useTabsSync from "./use-tabs-sync.js"
 */
