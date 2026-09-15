import type { StatusMeta } from "./status-meta";

/** Tailwind classes per semantic tone — text color only (never relies on color alone; callers pair this with an icon/symbol/label). */
export function toneTextClass(tone: StatusMeta["tone"]): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "danger":
      return "text-destructive";
    case "active":
      return "text-info";
    default:
      return "text-muted-foreground";
  }
}

/** Tailwind classes for a small status dot. */
export function toneDotClass(tone: StatusMeta["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "danger":
      return "bg-destructive";
    case "active":
      return "bg-info";
    default:
      return "bg-muted-foreground";
  }
}

/** Tailwind classes for a soft status badge (background + matching text). */
export function toneBadgeClass(tone: StatusMeta["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-success/10 text-success border-success/20";
    case "warning":
      return "bg-warning/10 text-warning border-warning/20";
    case "danger":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "active":
      return "bg-info/10 text-info border-info/20";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
