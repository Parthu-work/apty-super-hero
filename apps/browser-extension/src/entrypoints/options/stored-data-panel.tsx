import { DEFAULT_RETENTION_MS } from "@apty/agent-core";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
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
          <Trash2 className="h-5 w-5" />
          {t("storedData.title")}
        </CardTitle>
        <CardDescription>
          {t("storedData.description", { days: RETENTION_DAYS })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "confirming" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t("storedData.confirm")}</span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={purge}
            >
              {t("storedData.deleteEverything")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setState("idle")}
            >
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={state === "deleting"}
            onClick={() => setState("confirming")}
          >
            {t("storedData.deleteNow")}
          </Button>
        )}
        {state === "done" && (
          <p className="text-sm text-muted-foreground">
            {t("storedData.done")}
          </p>
        )}
        {state === "failed" && (
          <p className="text-sm text-destructive">{t("storedData.failed")}</p>
        )}
      </CardContent>
    </Card>
  );
}
