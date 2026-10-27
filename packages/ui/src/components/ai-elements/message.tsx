import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full",
      from === "user" ? "is-user justify-end" : "is-assistant justify-start",
      className,
    )}
    {...props}
  />
);

/**
 * The user's words in a quiet bubble on the right (radius 12, at most 85%
 * wide); the assistant's answer full width, with no bubble.
 */
export const MessageContent = ({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex min-w-0 flex-col gap-2 text-sm text-foreground",
      "group-[.is-user]:max-w-[85%] group-[.is-user]:rounded-lg group-[.is-user]:bg-muted group-[.is-user]:px-4 group-[.is-user]:py-3",
      "group-[.is-assistant]:w-full",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
