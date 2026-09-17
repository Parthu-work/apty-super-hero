/**
 * BrowserChatHeader
 * Custom header with conversation persistence and history dropdown
 */

import { useChatContext } from "@apty/ui/components/chatbot";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { getRuntime } from "@apty/ui/lib/runtime";
import { cn } from "@apty/ui/lib/utils";
import type { HeaderProps } from "@apty/ui/types";
import { conversationStorage } from "@apty/browser-runtime";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationHistory } from "./conversation-history";
import { releaseConversationTabBinding } from "./conversation-tab-binding";
import { InvestigationContextBar } from "./investigation/investigation-context-bar";
import { fromStorageFormat, toStorageFormat } from "./message-adapter";

export function BrowserChatHeader({
  title = "Apty Live Debugging",
  onSettingsClick,
  onNewChat,
  className,
  children,
  ...props
}: HeaderProps) {
  const { t } = useTranslation();
  const runtime = getRuntime();
  const { messages, setMessages, interrupt, sessionId, bindSession } =
    useChatContext();

  const [currentConversationId, setCurrentConversationId] = useState<
    string | undefined
  >();

  // Persistence: debounced save/update on messages change
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Debounce save for 1 second
    saveTimeoutRef.current = setTimeout(async () => {
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
            console.log(
              "💾 New conversation created and saved:",
              conversationId,
            );
          }
        }
      } catch (error) {
        console.error("❌ Failed to save conversation:", error);
      }
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [messages, currentConversationId, sessionId]);

  const handleOpenOptions = useCallback(() => {
    if (onSettingsClick) {
      onSettingsClick();
    } else if (runtime?.openOptionsPage) {
      runtime.openOptionsPage();
    }
  }, [onSettingsClick, runtime]);

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

      console.log(
        "✅ Conversation restored:",
        conversationId,
        conversation.title,
      );
    } catch (error) {
      console.error("❌ Failed to restore conversation:", error);
    }
  };

  const handleNewChat = useCallback(() => {
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

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-foreground">
          {title}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenOptions}
            title={t("tooltip.settings")}
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <SettingsIcon className="size-4" />
          </Button>

          {/* Conversation History */}
          <ConversationHistory
            currentConversationId={currentConversationId}
            onConversationSelect={handleConversationSelect}
            onNewConversation={handleNewChat}
            className="size-8 p-0 text-muted-foreground hover:text-foreground"
          />

          <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

          <Button
            variant="outline"
            size="sm"
            onClick={handleNewChat}
            title={t("tooltip.newChat")}
            className="gap-1.5"
          >
            <PlusIcon className="size-3.5" />
            <span className="hidden min-[360px]:inline">
              {t("common.newChat")}
            </span>
          </Button>
        </div>
      </div>

      <InvestigationContextBar />

      {children}
    </div>
  );
}
