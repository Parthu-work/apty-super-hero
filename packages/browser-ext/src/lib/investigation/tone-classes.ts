import type { StatusMeta } from "./status-meta";

/** Tailwind classes per semantic tone — text color only (never relies on color alone; callers pair this with an icon/symbol/label). */
export function toneTextClass(tone: StatusMeta["tone"]): string {
  switch (tone) {
    case "success":
      return "text-green-600 dark:text-green-400";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    case "danger":
      return "text-red-600 dark:text-red-400";
    case "active":
      return "text-blue-600 dark:text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

/** Tailwind classes for a small status dot. */
export function toneDotClass(tone: StatusMeta["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-green-500";
    case "warning":
      return "bg-amber-500";
    case "danger":
      return "bg-red-500";
    case "active":
      return "bg-blue-500";
    default:
      return "bg-muted-foreground";
  }
}
