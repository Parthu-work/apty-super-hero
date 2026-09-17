import type { ContextProvider } from "@apty/agent-core";

/**
 * Extended ContextProvider interface for browser-specific lifecycle methods
 */
export interface BrowserContextProvider extends ContextProvider {
  initialize?(): Promise<void>;
  teardown?(): Promise<void>;
}
