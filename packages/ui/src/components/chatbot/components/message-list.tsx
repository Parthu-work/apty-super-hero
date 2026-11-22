import { BrainIcon, ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useTranslation } from "../../../i18n/context";
import {
  type KbReturnedCards,
  kbReturnedCards,
} from "../../../lib/kb-citations";
import { cn } from "../../../lib/utils";
import type { MessageListProps, UIMessage } from "../../../types";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../../ai-elements/conversation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible";
import { useComponentsContext } from "../context";
import { CollapsedMessageItem, MessageItem } from "./message-item";
import { WelcomeScreen } from "./welcome-screen";

/**
 * A conversation turn: one optional user message followed by one or more
 * assistant messages produced before the next user message.
 */
interface ConversationTurn {
  userMessage?: UIMessage;
  assistantMessages: UIMessage[];
}

/**
 * Group a flat message list into conversation turns so we can collapse
 * intermediate assistant messages (thinking / tool-call steps).
 */
function groupIntoTurns(messages: UIMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      if (current) turns.push(current);
      current = { userMessage: message, assistantMessages: [] };
    } else if (message.role === "assistant") {
      if (!current) {
        current = { assistantMessages: [] };
      }
      current.assistantMessages.push(message);
    }
  }
  if (current) turns.push(current);
  return turns;
}

/**
 * Each turn's KB cards. A model turn that explains the chat (K27, E6) is
 * checked against the cards every turn up to it returned.
 */
function kbCardsByTurn(
  turns: ConversationTurn[],
): Map<ConversationTurn, KbReturnedCards> {
  const byTurn = new Map<ConversationTurn, KbReturnedCards>();
  const urls = new Map<string, string>();
  const texts: string[] = [];
  let searched = false;
  for (const turn of turns) {
    const own = kbReturnedCards(turn.assistantMessages.flatMap((m) => m.parts));
    for (const [pageId, url] of own.urls) urls.set(pageId, url);
    texts.push(...own.texts);
    searched ||= own.searched;
    const explains = turn.assistantMessages.some(
      (m) => m.metadata?.decision?.grounding === "conversation",
    );
    byTurn.set(
      turn,
      explains ? { searched, urls: new Map(urls), texts: [...texts] } : own,
    );
  }
  return byTurn;
}

/** Above this many turns, only the newest `WINDOW_TURNS` are rendered at first (K27, U1). */
const WINDOW_ABOVE = 100;
/** How many turns are rendered at first, and how many Show earlier messages adds. */
const WINDOW_TURNS = 60;
// No content-visibility on turns: its size estimate settles after the
// reader stops and moves the scroller (chat-scroll.e2e at 480 px); the
// window above keeps the DOM small instead.

/**
 * Show earlier messages: adds older turns above the shown ones and keeps
 * the reader where they were, by moving the scroller down by exactly the
 * height the new turns added.
 */
function ShowEarlier({ onShow }: { onShow: () => void }) {
  const { t } = useTranslation();
  const { scrollRef } = useStickToBottomContext();
  const before = useRef<{ height: number; top: number } | null>(null);
  const [shown, setShown] = useState(0);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const was = before.current;
    if (!scroller || !was || shown === 0) return;
    scroller.scrollTop = was.top + (scroller.scrollHeight - was.height);
    before.current = null;
  }, [shown, scrollRef]);
  return (
    <div className="flex justify-center">
      <button
        type="button"
        className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => {
          const scroller = scrollRef.current;
          if (scroller) {
            before.current = {
              height: scroller.scrollHeight,
              top: scroller.scrollTop,
            };
          }
          onShow();
          setShown((n) => n + 1);
        }}
      >
        {t("chat.showEarlier")}
      </button>
    </div>
  );
}

/**
 * Default MessageList component
 */
export function DefaultMessageList({
  messages,
  status,
  onRegenerate,
  onCopy,
  formatExport,
  onOpenProviderSettings,
  onSuggestionClick,
  className,
  ...props
}: MessageListProps & {
  onSuggestionClick?: (text: string) => void;
}) {
  const { slots } = useComponentsContext();
  const { t } = useTranslation();

  const running =
    status === "submitted" ||
    status === "streaming" ||
    status === "executing_tools";

  // Filter out system messages for display
  const displayMessages = messages.filter((m) => m.role !== "system");

  // Group into conversation turns for folding
  const turns = useMemo(
    () => groupIntoTurns(displayMessages),
    [displayMessages],
  );
  const cardsByTurn = useMemo(() => kbCardsByTurn(turns), [turns]);

  // K27, U1: a long chat renders its newest turns; earlier ones on request.
  const firstMessageId = displayMessages[0]?.id;
  const [windowStart, setWindowStart] = useState<{
    chat: string | undefined;
    from: number;
  }>({ chat: undefined, from: 0 });
  const start =
    windowStart.chat === firstMessageId
      ? windowStart.from
      : turns.length > WINDOW_ABOVE
        ? turns.length - WINDOW_TURNS
        : 0;
  const shownTurns = turns.slice(start);

  // Determine if a message is the very last display message
  const lastMessage = displayMessages[displayMessages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;

  return (
    <div
      className={cn("min-h-0 min-w-0 flex-1 overflow-hidden", className)}
      {...props}
    >
      <Conversation className="h-full">
        <ConversationContent className="space-y-4">
          {/* Before messages slot - for banners, announcements */}
          {slots.beforeMessages?.()}
          {displayMessages.length === 0 ? (
            <WelcomeScreen
              onSuggestionClick={(text) => {
                onSuggestionClick?.(text);
              }}
            />
          ) : (
            <>
              {start > 0 && (
                <ShowEarlier
                  onShow={() =>
                    setWindowStart({
                      chat: firstMessageId,
                      from: Math.max(0, start - WINDOW_TURNS),
                    })
                  }
                />
              )}
              {shownTurns.map((turn) => {
                // Generate stable key from message IDs
                const turnKey = turn.userMessage
                  ? turn.userMessage.id
                  : (turn.assistantMessages[0]?.id ?? "");
                return (
                  <div key={turnKey} className="space-y-2">
                    {/* Render user message */}
                    {turn.userMessage && (
                      <MessageItem
                        key={turn.userMessage.id}
                        message={turn.userMessage}
                        isLast={turn.userMessage.id === lastMessageId}
                        isStreaming={running}
                        onRegenerate={onRegenerate}
                        onCopy={onCopy}
                        formatExport={formatExport}
                        onOpenProviderSettings={onOpenProviderSettings}
                      />
                    )}

                    {/* Render assistant messages with folding */}
                    {turn.assistantMessages.length > 1
                      ? (() => {
                          const finalMsg =
                            turn.assistantMessages[
                              turn.assistantMessages.length - 1
                            ]!;
                          return (
                            <>
                              {/* Intermediate messages – collapsed by default */}
                              <Collapsible defaultOpen={false}>
                                <CollapsibleTrigger className="group flex h-10 w-full items-center gap-2 rounded-md px-3 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                                  <BrainIcon
                                    aria-hidden="true"
                                    className="size-4"
                                  />
                                  <span className="flex-1 text-left">
                                    {t("common.showThinkingDetails")}
                                  </span>
                                  <ChevronDownIcon
                                    aria-hidden="true"
                                    className="size-4 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                                  />
                                </CollapsibleTrigger>
                                <CollapsibleContent className="mt-2">
                                  <div className="space-y-2 rounded-md border border-border bg-card p-3">
                                    {turn.assistantMessages
                                      .slice(0, -1)
                                      .map((msg) => (
                                        <CollapsedMessageItem
                                          key={msg.id}
                                          message={msg}
                                        />
                                      ))}
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>

                              {/* Final assistant message – always expanded */}
                              <MessageItem
                                key={finalMsg.id}
                                message={finalMsg}
                                kbCards={cardsByTurn.get(turn)}
                                isLast={finalMsg.id === lastMessageId}
                                isStreaming={running}
                                onRegenerate={onRegenerate}
                                onCopy={onCopy}
                                formatExport={formatExport}
                                onOpenProviderSettings={onOpenProviderSettings}
                              />
                            </>
                          );
                        })()
                      : // Single assistant message – render normally
                        turn.assistantMessages.map((msg) => (
                          <MessageItem
                            key={msg.id}
                            message={msg}
                            kbCards={cardsByTurn.get(turn)}
                            isLast={msg.id === lastMessageId}
                            isStreaming={running}
                            onRegenerate={onRegenerate}
                            onCopy={onCopy}
                            formatExport={formatExport}
                            onOpenProviderSettings={onOpenProviderSettings}
                          />
                        ))}
                  </div>
                );
              })}
            </>
          )}
          {/* Running: after the last message until the turn ends */}
          {running &&
            (slots.loadingIndicator ? (
              slots.loadingIndicator()
            ) : (
              <div
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2Icon
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                <span>{t("common.processing")}</span>
              </div>
            ))}
          {/* After messages slot - for platform-specific content */}
          {slots.afterMessages?.()}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}

/**
 * MessageList - Renders either custom or default message list
 */
export function MessageList(
  props: MessageListProps & {
    onSuggestionClick?: (text: string) => void;
  },
) {
  const { components } = useComponentsContext();

  const CustomComponent = components.MessageList;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  return <DefaultMessageList {...props} />;
}
