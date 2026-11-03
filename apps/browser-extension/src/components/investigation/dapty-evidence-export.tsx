/**
 * "Export evidence" on the Ask Dapty card: the bundle an SE sends back from a
 * live-tenant test (`buildDaptyEvidenceBundle`), shown for review before it
 * leaves the browser. Only with Settings → Troubleshooting → Developer tools
 * on.
 */
import { type AppSettings, STORAGE_KEYS } from "@apty/agent-core";
import { buildDaptyEvidenceBundle } from "@apty/browser-runtime/apty/diagnosis/dapty-evidence";
import type { DiagnosisResult } from "@apty/browser-runtime/apty/diagnosis/types";
import { ChromeStorageAdapter } from "@apty/browser-runtime/storage/storage-adapter";
import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { agentBuild } from "./agent-build";
import { BundleReviewDialog } from "./bundle-review-dialog";

const settingsStorage = new ChromeStorageAdapter<AppSettings>();

/** Settings → Troubleshooting → Developer tools, kept current. */
function useDeveloperTools(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    const read = (settings: AppSettings | null | undefined) => {
      if (live) setOn(settings?.developerTools === true);
    };
    void settingsStorage
      .load(STORAGE_KEYS.SETTINGS)
      .then(read)
      .catch(() => undefined);
    const unwatch = settingsStorage.watch(STORAGE_KEYS.SETTINGS, (change) =>
      read(change.newValue),
    );
    return () => {
      live = false;
      unwatch();
    };
  }, []);
  return on;
}

function daptyEvidenceJson(result: DiagnosisResult): string {
  return JSON.stringify(
    buildDaptyEvidenceBundle({ result, versions: agentBuild() }),
    null,
    2,
  );
}

export function DaptyEvidenceExport({ result }: { result: DiagnosisResult }) {
  const { t } = useTranslation();
  const developerTools = useDeveloperTools();
  const [json, setJson] = useState<string | null>(null);
  if (!developerTools) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setJson(daptyEvidenceJson(result))}
      >
        <DownloadIcon aria-hidden="true" />
        {t("checkPack.daptyEvidence.export")}
      </Button>
      <BundleReviewDialog
        json={json}
        filePrefix="apty-dapty-evidence"
        descriptionKey="checkPack.daptyEvidence.reviewDescription"
        labelKey="checkPack.daptyEvidence.label"
        onClose={() => setJson(null)}
      />
    </>
  );
}
