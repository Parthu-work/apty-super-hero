/**
 * The Ask Dapty chat as the check reads it. The widget's AI assistant posts
 * each question to ai-service's widget chat (`POST …/ai/<tenantId>/widget/chat`)
 * and keeps each conversation in a stored chat file; a capture source hands
 * those calls over raw, and `dapty-parse.ts` turns them into turns.
 */

/** A chat call as a capture source saw it; the capture layer declares the same shape. */
export interface RawDaptyCall {
  source: "page" | "client" | "har";
  kind: "chat" | "stored-chat" | "chat-list";
  /** The full URL, read for its ids only and never shown. */
  url: string;
  method: string;
  status?: number;
  failed?: boolean;
  errorText?: string;
  requestBody?: string;
  responseBody?: string;
  /** The request's Origin header, when the source records it (a HAR does). */
  origin?: string;
  timestamp: number;
}

/** A turn read from the widget's chat panel, which shows suggestion names but not their ids. */
export interface RawDaptyDomTurn {
  role: "user" | "assistant" | "error";
  text: string;
  suggestionNames: string[];
}

export type DaptySource = "client" | "har" | "page" | "widget-dom";

export interface DaptySuggestion {
  /** The item's sourceId; missing when only the chat panel's names were read. */
  id?: string;
  name: string;
  /** Missing when only the chat panel's names were read. */
  type?: "workflow" | "knowledge_content";
}

export interface DaptyTurn {
  role: "user" | "assistant" | "error";
  /** Redacted, and cut to `MAX_TURN_CHARS`. */
  text: string;
  suggestions: DaptySuggestion[];
}

/** The newest chat call: what ai-service answered, and the ids its path names. */
export interface DaptyCall {
  status?: number;
  failed?: boolean;
  /** Redacted and stripped of URLs. */
  errorText?: string;
  tenantId?: string;
  applicationId?: string;
  /**
   * Who made the call: the page in injected mode, where ai-service's CORS
   * check applies, or the Client's service worker in extension mode, where
   * the extension's host permission lifts it. Unknown for a HAR without an
   * Origin header.
   */
  mode?: "injected" | "extension";
  timestamp: number;
}

export interface DaptyEvidence {
  source: DaptySource;
  connection: { ok: true } | { ok: false; failure: string; message: string };
  /** The conversation, oldest first, from the most complete record the source holds. */
  turns: DaptyTurn[];
  lastCall?: DaptyCall;
  /** Chat calls seen, failed ones included. */
  calls: number;
  /** Stored conversations read. */
  storedChats: number;
  /** Suggestions carry ids; false when they are names from the chat panel. */
  suggestionIds: boolean;
}
