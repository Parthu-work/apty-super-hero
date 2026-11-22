"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

type ConversationProps = ComponentProps<typeof StickToBottom>;

/**
 * The chat's scroller (KB-RAG K27, U1). Content that grows (a card or a
 * tree rendering, a disclosure opening, a font loading) keeps the bottom
 * without an animation that restarts on every resize; once the reader has
 * scrolled up, nothing scrolls for them and Scroll to bottom is offered.
 */
export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative min-h-0 flex-1 overflow-hidden", className)}
    initial="instant"
    resize="instant"
    role="log"
    {...props}
  />
);

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export const ConversationContent = ({
  className,
  scrollClassName,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("p-4", className)}
    scrollClassName={cn("[overflow-anchor:auto]", scrollClassName)}
    {...props}
  />
);

type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { t } = useTranslation();
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        aria-label={t("chat.scrollToBottom")}
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] shadow-sm",
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon-sm"
        type="button"
        variant="secondary"
        {...props}
      >
        <ArrowDownIcon aria-hidden="true" className="size-4" />
      </Button>
    )
  );
};
