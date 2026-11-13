/**
 * "Prepare support bundle" (KB-RAG K25, L2): assembles what Apty support
 * needs for the case and shows it in the review dialog, with the fields
 * still missing, Copy, Download (apty-support-<case id>.json) and Copy as
 * text. The extension sends nothing; the SE decides where the file goes.
 */
import { type CaseRecord, kbCardUrl } from "@apty/agent-core";
import type { DiagnosisResult } from "@apty/browser-runtime/apty/diagnosis/types";
import { loadBodyDenyList } from "@apty/browser-runtime/apty/extension-network-inspector";
import { buildSupportBundle } from "@apty/browser-runtime/case/support-bundle";
import { redactTextStrict } from "@apty/browser-runtime/runtime/redaction-mode";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { useState } from "react";
import { BundleReviewDialog } from "../investigation/bundle-review-dialog";

interface Prepared {
  json: string;
  markdown: string;
  missing: string[];
  id: string;
}

function extensionVersion(): string | undefined {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return undefined;
  }
}

export function SupportBundleButton({
  record,
  loadRecord,
  result,
}: {
  /** The case, or a way to read it when the button is pressed. */
  record?: CaseRecord;
  loadRecord?: () => Promise<CaseRecord | undefined>;
  /** The check the verdict card shows: its file entries and status codes. */
  result?: DiagnosisResult;
}) {
  const { t } = useTranslation();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [noCase, setNoCase] = useState(false);

  const prepare = async () => {
    const found = record ?? (await loadRecord?.());
    if (!found) {
      setNoCase(true);
      return;
    }
    const denyList = await loadBodyDenyList().catch(() => []);
    const built = buildSupportBundle({
      record: found,
      ...(result ? { result } : {}),
      userAgent: navigator.userAgent,
      ...(extensionVersion() ? { extensionVersion: extensionVersion() } : {}),
      redact: redactTextStrict,
      denyList,
      cardLink: (pageId) =>
        kbCardUrl(pageId, {
          aptyVersion: found.aptyVersion === "4.x" ? "4.x" : "5.x",
        }),
    });
    setPrepared({ ...built, id: found.id });
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void prepare()}
        data-testid="prepare-support-bundle"
      >
        {t("supportBundle.prepare")}
      </Button>
      {noCase && (
        <p className="text-small text-muted-foreground">
          {t("supportBundle.noCase")}
        </p>
      )}
      <BundleReviewDialog
        json={prepared?.json ?? null}
        filePrefix="apty-support"
        filename={prepared ? `apty-support-${prepared.id}.json` : undefined}
        descriptionKey="supportBundle.description"
        labelKey="supportBundle.label"
        onClose={() => setPrepared(null)}
        asText={
          prepared
            ? { labelKey: "supportBundle.copyText", text: prepared.markdown }
            : undefined
        }
      >
        {prepared && (
          <p className="text-sm text-foreground" data-testid="support-missing">
            {prepared.missing.length > 0
              ? t("supportBundle.missing", {
                  fields: prepared.missing.join(", "),
                })
              : t("supportBundle.noneMissing")}
          </p>
        )}
      </BundleReviewDialog>
    </>
  );
}
