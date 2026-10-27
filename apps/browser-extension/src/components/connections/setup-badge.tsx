import { StatusBadge } from "@apty/ui/components/ui/badge";
import { useTranslation } from "@apty/ui/i18n/context";
import type { ReactNode } from "react";
import { openOptions } from "../../lib/open-options";

function BadgeButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 cursor-pointer items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}

/** "N to set up", or nothing at zero. With `onClick` it is a button. */
export function SetupBadge({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  const badge = (
    <StatusBadge tone="warning" className={className}>
      {t("connections.setupCount", { count })}
    </StatusBadge>
  );
  return onClick ? <BadgeButton onClick={onClick}>{badge}</BadgeButton> : badge;
}

/** The composer's provider control while no provider is configured. */
export function ProviderSetupChip() {
  const { t } = useTranslation();
  return (
    <BadgeButton onClick={() => void openOptions({ section: "ai-provider" })}>
      <StatusBadge tone="warning">{t("setupNeeded.setUp")}</StatusBadge>
    </BadgeButton>
  );
}
