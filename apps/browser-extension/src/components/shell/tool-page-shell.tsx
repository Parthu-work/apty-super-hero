import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { ArrowLeftIcon } from "lucide-react";
import type { ReactNode } from "react";
import { navigationStore } from "../../state/navigation-store";
import { InvestigationContextBar } from "../investigation/investigation-context-bar";

/**
 * A tool page: a header with Back and the page title, the context bar, a
 * scrolling body and an optional sticky footer (one primary action, up to
 * two secondary ones and a hint line).
 */
export function ToolPageShell({
  title,
  trailing,
  footer,
  hint,
  children,
}: {
  title: string;
  /** A status badge or an icon action at the right of the header. */
  trailing?: ReactNode;
  footer?: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("shell.back")}
          onClick={() => navigationStore.back()}
        >
          <ArrowLeftIcon />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold text-foreground">
          {title}
        </h2>
        {trailing}
      </header>
      <InvestigationContextBar />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {(footer || hint) && (
        <footer className="shrink-0 space-y-2 border-t border-border bg-background p-4">
          {footer}
          {hint && (
            <p className="text-center text-small text-subtle-foreground">
              {hint}
            </p>
          )}
        </footer>
      )}
    </>
  );
}
