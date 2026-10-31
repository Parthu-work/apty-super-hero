/**
 * Where the Ask Dapty check reads the chat for the conversation's tab, best
 * record first: the page's own calls (Injected mode, where the page makes
 * them), the Apty Client's record (Extension mode), then the widget's chat
 * panel, which shows names but no ids or call. The readers are passed in,
 * so the check runs with whichever the build has.
 */

import { loadDaptyFromClient } from "./dapty-loader.js";
import { daptyEvidenceFromCalls, daptyEvidenceFromDom } from "./dapty-parse.js";
import type {
  DaptyEvidence,
  RawDaptyCall,
  RawDaptyDomTurn,
} from "./dapty-types.js";

export interface DaptyReaders {
  /** The chat calls the page in a tab made, newest last. */
  pageCalls?: (tabId: number) => Promise<RawDaptyCall[]>;
  /** The turns the widget's chat panel shows in a tab. */
  widgetTurns?: (
    tabId: number,
  ) => Promise<
    { ok: true; turns: RawDaptyDomTurn[] } | { ok: false; reason: string }
  >;
  /** Overridable for tests; the Apty Client's record by default. */
  client?: (extensionId: string | undefined) => Promise<DaptyEvidence>;
}

const holdsChat = (evidence: DaptyEvidence) =>
  evidence.connection.ok && (evidence.turns.length > 0 || evidence.calls > 0);

/**
 * The `daptyOf` source for `createDiagnosisResponder`. A reader that throws
 * counts as holding nothing, so the next one is tried.
 */
export function createDaptySource(readers: DaptyReaders) {
  const client = readers.client ?? loadDaptyFromClient;
  return async (
    runContext: unknown,
    clientExtensionId: string | undefined,
  ): Promise<DaptyEvidence> => {
    const tabId = (runContext as { tabId?: unknown } | undefined)?.tabId;
    const tab = typeof tabId === "number" ? tabId : undefined;

    if (tab !== undefined && readers.pageCalls) {
      const calls = await readers.pageCalls(tab).catch(() => []);
      const page = daptyEvidenceFromCalls(calls, "page");
      if (holdsChat(page)) return page;
    }
    const recorded = await client(clientExtensionId);
    if (holdsChat(recorded)) return recorded;
    if (tab !== undefined && readers.widgetTurns) {
      const read = await readers
        .widgetTurns(tab)
        .catch(() => ({ ok: false as const, reason: "not-readable" }));
      if (read.ok && read.turns.length > 0) {
        return daptyEvidenceFromDom(read.turns);
      }
    }
    return recorded;
  };
}
