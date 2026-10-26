/**
 * "Export validation bundle" (WP B2): what an Apty engineer sends back after
 * running DOM Health on a real tenant. The bundle is built from an
 * allow-list and strictly redacted by `buildValidationBundle`; the engineer
 * still reviews the exact JSON before it leaves the browser.
 */
import {
  type ApplicationAuditOutcome,
  buildValidationBundle,
  chromeVersionFrom,
  type DomHealthAuditOutcome,
  type RouteProbeReport,
  resolveThresholds,
} from "@apty/browser-runtime";
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
import { DownloadIcon } from "lucide-react";
import { useState } from "react";

export interface ValidationBundleSources {
  page?: DomHealthAuditOutcome | null;
  application?: ApplicationAuditOutcome | null;
  probe?: RouteProbeReport | null;
  thresholdOverrides?: Record<string, number>;
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

function validationBundleJson({
  page,
  application,
  probe,
  thresholdOverrides,
}: ValidationBundleSources): string {
  const bundle = buildValidationBundle({
    page: page?.available ? page : null,
    application: application?.available ? application : null,
    probe: probe ?? null,
    thresholds: resolveThresholds(thresholdOverrides ?? {}),
    versions: {
      extension: extensionVersion(),
      chrome: chromeVersionFrom(navigator.userAgent),
    },
  });
  return JSON.stringify(bundle, null, 2);
}

function download(json: string) {
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `apty-dom-health-validation-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The download icon in the DOM health page's header; the engineer reviews the JSON before it leaves. */
export function ValidationBundleExport(sources: ValidationBundleSources) {
  const { t } = useTranslation();
  const [json, setJson] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hasEvidence =
    sources.page?.available === true ||
    sources.application?.available === true ||
    !!sources.probe;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        disabled={!hasEvidence}
        aria-label={t("investigation.bundle.export")}
        title={t("investigation.bundle.export")}
        onClick={() => {
          setCopied(false);
          setJson(validationBundleJson(sources));
        }}
      >
        <DownloadIcon />
      </Button>
      <Dialog
        open={json !== null}
        onOpenChange={(open) => !open && setJson(null)}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t("investigation.bundle.review")}</DialogTitle>
            <DialogDescription>
              {t("investigation.bundle.reviewDescription")}
            </DialogDescription>
          </DialogHeader>
          <section
            aria-label={t("investigation.bundle.label")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <pre
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard (axe scrollable-region-focusable).
              tabIndex={0}
              className="min-h-24 flex-1 overflow-auto rounded border bg-muted/40 p-2 text-xs"
            >
              {json}
            </pre>
          </section>
          <DialogFooter className="shrink-0 flex-row flex-wrap justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setJson(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (json === null) return;
                void navigator.clipboard
                  .writeText(json)
                  .then(() => setCopied(true));
              }}
            >
              {t(copied ? "common.copied" : "common.copy")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (json !== null) download(json);
                setJson(null);
              }}
            >
              {t("common.download")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
