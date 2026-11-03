/**
 * "Export validation bundle" (WP B2): what an Apty engineer sends back after
 * running DOM Health on a real tenant. The bundle is built from an
 * allow-list and strictly redacted by `buildValidationBundle`; the engineer
 * still reviews the exact JSON before it leaves the browser.
 */
import {
  type ApplicationAuditOutcome,
  buildValidationBundle,
  type DomHealthAuditOutcome,
  type RouteProbeReport,
  resolveThresholds,
} from "@apty/browser-runtime";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { agentBuild } from "./agent-build";
import { BundleReviewDialog } from "./bundle-review-dialog";

export interface ValidationBundleSources {
  page?: DomHealthAuditOutcome | null;
  application?: ApplicationAuditOutcome | null;
  probe?: RouteProbeReport | null;
  thresholdOverrides?: Record<string, number>;
}

/** The bundle as reviewed JSON; "Ask about this result" sends the same summary. */
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
    versions: (({ agent, chrome }) => ({ extension: agent, chrome }))(
      agentBuild(),
    ),
  });
  return JSON.stringify(bundle, null, 2);
}

/** The download icon in the DOM health page's header; the engineer reviews the JSON before it leaves. */
export function ValidationBundleExport(sources: ValidationBundleSources) {
  const { t } = useTranslation();
  const [json, setJson] = useState<string | null>(null);
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
          setJson(validationBundleJson(sources));
        }}
      >
        <DownloadIcon />
      </Button>
      <BundleReviewDialog
        json={json}
        filePrefix="apty-dom-health-validation"
        descriptionKey="investigation.bundle.reviewDescription"
        labelKey="investigation.bundle.label"
        onClose={() => setJson(null)}
      />
    </>
  );
}
