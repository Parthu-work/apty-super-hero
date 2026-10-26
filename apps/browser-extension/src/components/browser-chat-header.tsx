/**
 * BrowserChatHeader
 * The side panel header (Menu, app mark, title, New chat), the context bar,
 * conversation persistence and the menu drawer with the recent chats.
 */

import { createLogger } from "@apty/agent-core";
import { conversationStorage } from "@apty/browser-runtime";
import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import type { HeaderProps } from "@apty/ui/types";
import { ActivityIcon, MenuIcon, SquarePenIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openOptions } from "../lib/open-options";
import { releaseConversationTabBinding } from "../services/conversation-tab-binding";
import {
  fromStorageFormat,
  toStorageFormat,
} from "../services/message-adapter";
import { navigationStore, useNavigation } from "../state/navigation-store";
import { InvestigationContextBar } from "./investigation/investigation-context-bar";
import { MenuDrawer } from "./shell/menu-drawer";

const log = createLogger("BrowserChatHeader");

export function BrowserChatHeader({
  title: _title,
  onSettingsClick: _onSettingsClick,
  onNewChat,
  className,
  children,
  ...props
}: HeaderProps) {
  const { t } = useTranslation();
  const {
    messages,
    status,
    setMessages,
    interrupt,
    sessionId,
    bindSession,
    sendMessage,
  } = useChatContext();
  const { page, drawerOpen } = useNavigation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const [currentConversationId, setCurrentConversationId] = useState<
    string | undefined
  >();

  // Persistence: debounced save/update on messages change, plus an
  // immediate flush used by Back (below) so leaving the conversation can
  // never race the debounce timer and lose the last turn.
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    const saveNow = async () => {
      // Only save if we have non-system messages
      const nonSystemMessages = messages.filter((msg) => msg.role !== "system");
      if (nonSystemMessages.length === 0) return;

      try {
        if (currentConversationId) {
          // Update existing conversation
          await conversationStorage.updateConversation(
            currentConversationId,
            toStorageFormat(messages),
            sessionId ?? undefined,
          );
        } else if (nonSystemMessages.length >= 2) {
          // Create new conversation only when we have at least user message + assistant response
          const conversationId = await conversationStorage.saveConversation(
            toStorageFormat(messages),
            sessionId ?? undefined,
          );
          if (conversationId) {
            setCurrentConversationId(conversationId);
            log.debug("💾 New conversation created and saved:", conversationId);
          }
        }
      } catch (error) {
        console.error("❌ Failed to save conversation:", error);
      }
    };
    saveNowRef.current = saveNow;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save for 1 second
    saveTimeoutRef.current = setTimeout(saveNow, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, currentConversationId, sessionId]);

  const handleConversationSelect = async (conversationId: string) => {
    try {
      const conversation =
        await conversationStorage.getConversation(conversationId);
      if (!conversation) {
        console.warn("⚠️ Conversation not found:", conversationId);
        return;
      }

      // Interrupt any ongoing operation
      if (interrupt) {
        await interrupt();
      }

      // Set the current conversation ID first
      setCurrentConversationId(conversationId);

      // Restore messages to UI state (convert from storage format)
      setMessages(fromStorageFormat(conversation.messages));

      // Release the outgoing session's tab binding — it's being switched
      // away from, so its bound tab (if any) shouldn't be reused by
      // whatever session comes next.
      if (sessionId) {
        releaseConversationTabBinding(sessionId);
      }

      // Rebind the agent's active session to the one this conversation
      // actually owns (or null, forcing a fresh session on next send).
      // Without this, the next message would silently continue whatever
      // session was previously active — i.e. this conversation's UI would
      // receive replies generated from a *different* conversation's agent
      // memory. `agentSessionId` is undefined for conversations saved
      // before this field existed; those fall back to a fresh session.
      bindSession(conversation.agentSessionId ?? null);

      log.debug(
        "✅ Conversation restored:",
        conversationId,
        conversation.title,
      );
    } catch (error) {
      console.error("❌ Failed to restore conversation:", error);
    }
  };

  const startFreshChat = useCallback(() => {
    // Clear current conversation ID so next save creates new conversation
    setCurrentConversationId(undefined);

    // Release the outgoing session's tab binding (onNewChat below deletes
    // the session itself via useChat's reset()).
    if (sessionId) {
      releaseConversationTabBinding(sessionId);
    }

    // Call the passed onNewChat (resets messages and clears input)
    onNewChat?.();
  }, [onNewChat, sessionId]);

  const hasConversation =
    messages.filter((msg) => msg.role !== "system").length > 0;

  // New chat: confirm if a response is still running, interrupt it, save
  // the conversation now (never racing the debounce), then start fresh.
  const newChat = useCallback(async () => {
    const isRunning = status === "streaming" || status === "submitted";
    if (isRunning) {
      if (!window.confirm(t("shell.newChatConfirm"))) return;
      await interrupt();
    }
    await saveNowRef.current();
    startFreshChat();
  }, [status, interrupt, startFreshChat, t]);

  // Alt+Left: back one page when a tool page is open, else a new chat.
  useEffect(() => {
    if (page === null && !hasConversation) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        if (page !== null) navigationStore.back();
        else void newChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, hasConversation, newChat]);

  return (
    <div className={cn("flex shrink-0 flex-col", className)} {...props}>
      <div className="flex h-14 items-center gap-2 border-b border-border px-2">
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="icon"
          aria-label={t("shell.menu")}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => navigationStore.openDrawer()}
        >
          <MenuIcon />
        </Button>
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground"
        >
          <ActivityIcon className="size-4" />
        </span>
        <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-foreground">
          {t("shell.appName")}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("shell.newChat")}
          title={t("shell.newChat")}
          onClick={() => void newChat()}
        >
          <SquarePenIcon />
        </Button>
      </div>

      <InvestigationContextBar />

      {children}

      <MenuDrawer
        menuButtonRef={menuButtonRef}
        currentConversationId={currentConversationId}
        onNewChat={() => void newChat()}
        onSelectConversation={(id) => void handleConversationSelect(id)}
        onConversationDeleted={(id) => {
          if (id === currentConversationId) startFreshChat();
        }}
        onSendPrompt={(text) => void sendMessage(text)}
        onOpenConnections={() => void openOptions({ tab: "connection" })}
        onOpenSettings={() => void openOptions()}
      />
    </div>
  );
}
