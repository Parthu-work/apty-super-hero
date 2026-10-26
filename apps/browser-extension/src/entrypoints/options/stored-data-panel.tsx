import { DEFAULT_RETENTION_MS } from "@apty/agent-core";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { Notice } from "@apty/ui/components/ui/notice";
import { useTranslation } from "@apty/ui/i18n/context";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { purgeStoredData } from "../../services/stored-data";

const RETENTION_DAYS = Math.round(DEFAULT_RETENTION_MS / (24 * 60 * 60 * 1000));

type PurgeState = "idle" | "confirming" | "deleting" | "done" | "failed";

/** States the retention policy and deletes every stored conversation and screenshot on request. */
export function StoredDataPanel() {
  const { t } = useTranslation();
  const [state, setState] = useState<PurgeState>("idle");

  const purge = async () => {
    setState("deleting");
    try {
      await purgeStoredData();
      setState("done");
    } catch {
      setState("failed");
    }
  };

  return (
    <Card id="stored-data" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 aria-hidden="true" className="size-5" />
          {t("storedData.title")}
        </CardTitle>
        <CardDescription>
          {t("storedData.description", { days: RETENTION_DAYS })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="danger"
          disabled={state === "deleting"}
          onClick={() => setState("confirming")}
        >
          {t("storedData.deleteNow")}
        </Button>
        <ConfirmDialog
          open={state === "confirming" || state === "deleting"}
          onOpenChange={(open) => {
            if (!open) setState("idle");
          }}
          title={t("storedData.confirm")}
          description={t("storedData.description", { days: RETENTION_DAYS })}
          confirmLabel={t("storedData.deleteEverything")}
          onConfirm={() => void purge()}
          pending={state === "deleting"}
        />
        {state === "done" && (
          <Notice tone="success">{t("storedData.done")}</Notice>
        )}
        {state === "failed" && (
          <Notice tone="error">{t("storedData.failed")}</Notice>
        )}
      </CardContent>
    </Card>
  );
}
