import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n/context";
import { copyText } from "../../lib/clipboard";
import { cn } from "../../lib/utils";
import { Button } from "./button";

/** How long the check mark replaces the copy icon after a copy. */
const COPIED_MS = 1500;

/** `copied` turns true on `flash()` and back to false 1.5 s later. */
export function useCopiedFlag(): [copied: boolean, flash: () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }, []);
  return [copied, flash];
}

/**
 * A compact icon button that copies `text`. After a successful copy its
 * icon is a check and its name "Copied" for 1.5 s.
 */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  /** The button's name before copying; "Copy" when absent. */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [copied, flash] = useCopiedFlag();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? t("common.copied") : (label ?? t("common.copy"))}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={async () => {
        if (await copyText(text)) flash();
      }}
    >
      {copied ? (
        <CheckIcon aria-hidden="true" />
      ) : (
        <CopyIcon aria-hidden="true" />
      )}
    </Button>
  );
}
