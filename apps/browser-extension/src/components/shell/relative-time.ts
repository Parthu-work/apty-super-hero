import type { TranslationKey } from "@apty/ui/i18n/types";

type Translate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

/** "Just now", "12 min ago", "1 h ago", "Yesterday", "3 days ago" or a date. */
export function relativeTime(
  timestamp: number,
  t: Translate,
  now: number = Date.now(),
): string {
  const diffInMs = now - timestamp;
  const diffInHours = diffInMs / (1000 * 60 * 60);

  if (diffInHours < 1) {
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    if (diffInMinutes <= 1) {
      return t("conversationHistory.timeFormat.justNow");
    }
    return t("conversationHistory.timeFormat.minutesAgo", {
      count: diffInMinutes,
    });
  }
  if (diffInHours < 24) {
    const hours = Math.floor(diffInHours);
    if (hours === 1) {
      return t("conversationHistory.timeFormat.hourAgo");
    }
    return t("conversationHistory.timeFormat.hoursAgo", { count: hours });
  }
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) {
    return t("conversationHistory.timeFormat.yesterday");
  }
  if (diffInDays < 7) {
    return t("conversationHistory.timeFormat.daysAgo", { count: diffInDays });
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
