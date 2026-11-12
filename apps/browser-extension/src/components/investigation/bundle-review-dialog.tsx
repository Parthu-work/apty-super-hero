/**
 * "Review before sharing": the exact JSON an export would save, shown before
 * it leaves the browser, with Copy and Download. Used by DOM Health's
 * validation bundle, the Ask Dapty evidence bundle, and (KB-RAG K25) the
 * support bundle and the feedback exports, which add what is missing, a
 * text form to copy, and a file of another type (CSV).
 */
import { Button } from "@apty/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@apty/ui/components/ui/dialog";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { type ReactNode, useEffect, useState } from "react";

function download(json: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([json], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface BundleReviewDialogProps {
  /** The JSON to review; null keeps the dialog closed. */
  json: string | null;
  /** The downloaded file's name, without the timestamp and extension. */
  filePrefix: string;
  /** What the bundle holds and leaves out, and its name for screen readers. */
  descriptionKey: TranslationKey;
  labelKey: TranslationKey;
  onClose: () => void;
  /** The downloaded file's exact name, in place of `filePrefix` and a timestamp. */
  filename?: string;
  /** The file's media type; JSON by default. */
  mediaType?: string;
  /** Shown above the content, such as the fields the SE should add. */
  children?: ReactNode;
  /** A second form of the same data to copy, such as a Markdown summary. */
  asText?: { labelKey: TranslationKey; text: string };
}

export function BundleReviewDialog({
  json,
  filePrefix,
  descriptionKey,
  labelKey,
  onClose,
  filename,
  mediaType = "application/json",
  children,
  asText,
}: BundleReviewDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  useEffect(() => {
    if (json !== null) {
      setCopied(false);
      setCopiedText(false);
    }
  }, [json]);

  return (
    <Dialog open={json !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="wide"
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>{t("investigation.bundle.review")}</DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>
        {children}
        <section
          aria-label={t(labelKey)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <pre
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard (axe scrollable-region-focusable).
            tabIndex={0}
            className="min-h-24 flex-1 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-4 text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {json}
          </pre>
        </section>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (json === null) return;
              void navigator.clipboard
                .writeText(json)
                .then(() => setCopied(true));
            }}
          >
            {t(copied ? "common.copied" : "common.copy")}
          </Button>
          {asText && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  .writeText(asText.text)
                  .then(() => setCopiedText(true));
              }}
            >
              {copiedText ? t("common.copied") : t(asText.labelKey)}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => {
              if (json !== null) {
                download(
                  json,
                  filename ?? `${filePrefix}-${Date.now()}.json`,
                  mediaType,
                );
              }
              onClose();
            }}
          >
            {t("common.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
