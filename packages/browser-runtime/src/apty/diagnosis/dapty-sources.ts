/**
 * Where the Ask Dapty check reads the chat for the conversation's tab, best
 * record first: the page's own calls (Injected mode, where the page makes
 * them), the Apty Client's record (Extension mode), the stored chat on
 * Apty's content CDN (any mode, when the page holds the user's ID), then the
 * widget's chat panel, which shows names but no ids or call. The content
 * files come from the Client, or from the CDN when the Client does not
 * report its calls. The readers are passed in, so the check runs with
 * whichever the build has.
 */

import { getDaptyPageCalls } from "../dapty-page-capture.js";
import { readDaptyWidgetTurns } from "../dapty-widget-reader.js";
import {
  type AptyWidgetChatRead,
  ConfiguredServiceWorkerDiagnosticsProvider,
} from "../service-worker-diagnostics.js";
import {
  type AptyFilesReaders,
  createAptyFiles,
  DEFAULT_APTY_FILES_READERS,
  tabOf,
} from "./apty-files.js";
import { DAPTY_FILES } from "./dapty-conversation.js";
import { loadDaptyFrom, loadDaptyFromClient } from "./dapty-loader.js";
import {
  daptyEvidenceFromCalls,
  daptyEvidenceFromDom,
  daptyTurnsFromClientChat,
} from "./dapty-parse.js";
import type {
  DaptyEvidence,
  RawDaptyCall,
  RawDaptyDomTurn,
  StoredChatUnread,
} from "./dapty-types.js";

interface DaptyReaders extends AptyFilesReaders {
  /** The chat calls the page in a tab made, newest last. */
  pageCalls?: (tabId: number) => Promise<RawDaptyCall[]>;
  /** The turns the widget's chat panel shows in a tab. */
  widgetTurns?: (
    tabId: number,
  ) => Promise<
    { ok: true; turns: RawDaptyDomTurn[] } | { ok: false; reason: string }
  >;
  /** The Widget's own conversations, as the Apty Client reports them. */
  widgetChat?: (extensionId: string | undefined) => Promise<AptyWidgetChatRead>;
  /** Overridable for tests; the Apty Client's record by default. */
  client?: (extensionId: string | undefined) => Promise<DaptyEvidence>;
}

const holdsChat = (evidence: DaptyEvidence) =>
  evidence.connection.ok && (evidence.turns.length > 0 || evidence.calls > 0);

/**
 * The `daptyOf` and `daptyFilesOf` sources for `createDiagnosisResponder`.
 * A reader that throws counts as holding nothing, so the next one is tried.
 * The chat and the files share one CDN read.
 * @internal
 */
export function createDaptySource(readers: DaptyReaders) {
  const client = readers.client ?? loadDaptyFromClient;
  const apty = createAptyFiles(readers);

  async function chat(
    runContext: unknown,
    clientExtensionId: string | undefined,
  ): Promise<DaptyEvidence> {
    const tab = tabOf(runContext);

    if (tab !== undefined && readers.pageCalls) {
      const calls = await readers.pageCalls(tab).catch(() => []);
      const page = daptyEvidenceFromCalls(calls, "page");
      if (holdsChat(page)) return page;
    }
    const id = await apty.clientIdFor(tab, clientExtensionId);
    const [recorded, reported] = await Promise.all([
      client(id),
      readers.widgetChat
        ? readers.widgetChat(id).catch(() => undefined)
        : undefined,
    ]);
    // The Widget's own state holds every turn with ids; the recorded calls
    // still say how the newest call went.
    const newest = reported?.ok ? reported.chats.at(-1) : undefined;
    const turns = newest ? daptyTurnsFromClientChat(newest.turns) : [];
    if (turns.length > 0) {
      return {
        ...recorded,
        source: "client",
        connection: { ok: true },
        turns,
        suggestionIds: true,
      };
    }
    if (holdsChat(recorded)) return recorded;

    let unread: StoredChatUnread | undefined;
    const cdn = apty.cdnFor(tab, DAPTY_FILES, true);
    if (cdn) {
      const stored = await loadDaptyFrom(cdn, "cdn").catch(() => undefined);
      if (stored && holdsChat(stored)) return stored;
      const state = await cdn.storedChat().catch(() => undefined);
      if (state === "apty-id" || state === "no-user-value") unread = state;
    }
    if (tab !== undefined && readers.widgetTurns) {
      const read = await readers
        .widgetTurns(tab)
        .catch(() => ({ ok: false as const, reason: "not-readable" }));
      if (read.ok && read.turns.length > 0) {
        return {
          ...daptyEvidenceFromDom(read.turns),
          ...(unread ? { storedChatUnread: unread } : {}),
        };
      }
    }
    return unread ? { ...recorded, storedChatUnread: unread } : recorded;
  }

  const files = (runContext: unknown, clientExtensionId: string | undefined) =>
    apty.files(runContext, clientExtensionId, DAPTY_FILES, {
      storedChats: true,
    });

  return { chat, files };
}

const forTab = createDaptySource({
  ...DEFAULT_APTY_FILES_READERS,
  pageCalls: getDaptyPageCalls,
  widgetTurns: readDaptyWidgetTurns,
  widgetChat: (extensionId) =>
    new ConfiguredServiceWorkerDiagnosticsProvider({
      extensionId,
      peer: "client",
    }).readWidgetChat(),
});

/** The chat for the conversation's tab from every source this build has. */
export const readDaptyForTab = forTab.chat;

/** The content files the Ask Dapty check reads, for the conversation's tab. */
export const readDaptyFilesForTab = forTab.files;
