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

export function validationBundleJson({
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

export function ValidationBundleExport(sources: ValidationBundleSources) {
  const [json, setJson] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const hasEvidence =
    sources.page?.available === true ||
    sources.application?.available === true ||
    !!sources.probe;

  return (
    <>
      <Button
        size="sm"
        variant="link"
        className="h-auto p-0 text-[11px]"
        disabled={!hasEvidence}
        onClick={() => {
          setCopied(false);
          setJson(validationBundleJson(sources));
        }}
      >
        Export validation bundle
      </Button>
      <Dialog
        open={json !== null}
        onOpenChange={(open) => !open && setJson(null)}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Review before sharing</DialogTitle>
            <DialogDescription>
              Hostnames, URL templates, frame roles, counts, hashes, thresholds
              and timings only: no element text, input values, page titles,
              record numbers or cookies. Check it before you send it.
            </DialogDescription>
          </DialogHeader>
          <section
            aria-label="Validation bundle"
            className="flex min-h-0 flex-1 flex-col"
          >
            <pre
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must be reachable by keyboard (axe scrollable-region-focusable).
              tabIndex={0}
              className="min-h-24 flex-1 overflow-auto rounded border bg-muted/40 p-2 text-[10px]"
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
              Cancel
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
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (json !== null) download(json);
                setJson(null);
              }}
            >
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
