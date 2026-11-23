/**
 * The header's pack-status icon (KB-RAG K29, L1), its "Packs:" line, and
 * the delivered-pack banner (KB-RAG K27, E9). The banner floats over the
 * top of the chat instead of pushing it down, so a conversation being read
 * never moves.
 */
import { Button } from "@apty/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@apty/ui/components/ui/tooltip";
import { useTranslation } from "@apty/ui/i18n/context";
import { cn } from "@apty/ui/lib/utils";
import { PackageIcon } from "lucide-react";
import {
  type DeliveredPack,
  type PackHeaderItem,
  type PackStatusTone,
  packStatusTone,
} from "./pack-freshness";

const TONE_CLASS: Record<PackStatusTone, string> = {
  none: "text-muted-foreground",
  ok: "text-muted-foreground",
  warning: "text-warning",
  danger: "text-destructive",
};

function useItemWords() {
  const { t } = useTranslation();
  return (item: PackHeaderItem) => {
    const { version } = item;
    switch (item.state) {
      case "ok":
        return t("packFreshness.item.ok", { version });
      case "expires":
        return item.days === 1
          ? t("packFreshness.item.expiresOne", { version })
          : t("packFreshness.item.expires", { version, count: item.days });
      case "expired":
        return t("packFreshness.item.expired", { version });
      case "notUsed":
        return t("packFreshness.item.notUsed", { version });
    }
  };
}

function PacksLine({
  items,
  className,
}: {
  items: PackHeaderItem[] | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const words = useItemWords();
  const text =
    items === undefined
      ? ""
      : items.length === 0
        ? t("packFreshness.none")
        : t("packFreshness.line", { list: items.map(words).join(", ") });
  return (
    <span
      className={cn(
        "block min-h-4 truncate text-xs text-muted-foreground",
        className,
      )}
      data-testid="kb-packs-line"
    >
      {text}
    </span>
  );
}

/**
 * One small icon for every pack's state: its name is the "Packs:" line, its
 * tooltip lists each version, and it opens Options' Knowledge base.
 */
export function PackStatusIcon({
  items,
  onOpen,
}: {
  items: PackHeaderItem[] | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const words = useItemWords();
  const tone = packStatusTone(items ?? []);
  const list =
    items === undefined
      ? t("packFreshness.status")
      : items.length === 0
        ? t("packFreshness.none")
        : items.map(words).join(", ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="kb-pack-status"
          data-tone={tone}
          onClick={onOpen}
        >
          <PackageIcon aria-hidden="true" className={TONE_CLASS[tone]} />
          {items === undefined ? (
            <span className="sr-only">{t("packFreshness.status")}</span>
          ) : (
            <PacksLine items={items} className="sr-only" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" data-testid="kb-pack-status-tooltip">
        {list}
      </TooltipContent>
    </Tooltip>
  );
}

export function PackUpdateBanner({
  delivered,
  onDismiss,
  onOpen,
}: {
  delivered: DeliveredPack[];
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  if (delivered.length === 0) return null;
  return (
    <div
      role="status"
      className="absolute inset-x-2 top-full z-20 mt-2 rounded-lg border border-border bg-card p-3 shadow-md"
      data-testid="kb-pack-update"
    >
      <p className="text-sm font-medium text-foreground">
        {t("packFreshness.banner.title")}
      </p>
      <ul className="mt-1 text-small text-muted-foreground">
        {delivered.map((pack) => (
          <li key={pack.version}>
            {t("packFreshness.banner.pack", {
              version: pack.version,
              date: pack.builtAt.slice(0, 10),
            })}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onDismiss}>
          {t("packFreshness.banner.gotIt")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {t("packFreshness.banner.open")}
        </Button>
      </div>
    </div>
  );
}
