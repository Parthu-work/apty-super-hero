import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "../../../i18n/context";
import { cn } from "../../../lib/utils";
import type { MessageListProps, UIMessage } from "../../../types";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../../ai-elements/conversation";
import { Loader } from "../../ai-elements/loader";
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

  // Filter out system messages for display
  const displayMessages = messages.filter((m) => m.role !== "system");

  // Group into conversation turns for folding
  const turns = useMemo(
    () => groupIntoTurns(displayMessages),
    [displayMessages],
  );

  // Determine if a message is the very last display message
  const lastMessage = displayMessages[displayMessages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;

  return (
    <div className={cn("min-w-0 flex-1 overflow-hidden", className)} {...props}>
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
            turns.map((turn) => {
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
                      isStreaming={status === "streaming"}
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
                              isLast={finalMsg.id === lastMessageId}
                              isStreaming={status === "streaming"}
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
                          isLast={msg.id === lastMessageId}
                          isStreaming={status === "streaming"}
                          onRegenerate={onRegenerate}
                          onCopy={onCopy}
                          formatExport={formatExport}
                          onOpenProviderSettings={onOpenProviderSettings}
                        />
                      ))}
                </div>
              );
            })
          )}
          {/* Loading indicator */}
          {status === "submitted" &&
            (slots.loadingIndicator ? (
              slots.loadingIndicator()
            ) : (
              <div className="flex w-full justify-end py-2">
                <div className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
                  <Loader size={14} />
                  <span>{t("common.processing")}</span>
                </div>
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
