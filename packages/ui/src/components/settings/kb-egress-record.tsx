/**
 * "KB text sent to AI" in the Data handling card (KB-RAG K22, S7): how many
 * requests carried KB card text in the last 30 days, Export as JSON, and
 * Clear (disabled under an organization policy). The record holds ids,
 * never text; the host app reads and writes it.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n/context";
import { downloadText } from "../../lib/download";
import { Button } from "../ui/button";
import type { KbEgressLogAdapter } from "./types";

export function KbEgressRecord({ log }: { log: KbEgressLogAdapter }) {
  const { t } = useTranslation();
  const [count, setCount] = useState<number>();
  const [clearAllowed, setClearAllowed] = useState(false);

  const refresh = useCallback(async () => {
    const [n, allowed] = await Promise.all([
      log.countLast30Days(),
      log.clearAllowed(),
    ]);
    setCount(n);
    setClearAllowed(allowed);
  }, [log]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return (
    <section
      aria-labelledby="kb-egress-title"
      className="space-y-2"
      data-testid="kb-egress-record"
    >
      <h3 id="kb-egress-title" className="text-sm font-medium">
        {t("kbEgressLog.title")}
      </h3>
      <p className="text-sm" role="status">
        {count === undefined ? "…" : t("kbEgressLog.count", { count })}
      </p>
      <p className="text-xs text-muted-foreground">{t("kbEgressLog.what")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () =>
            downloadText(
              `apty-kb-sent-${new Date().toISOString().slice(0, 10)}.json`,
              await log.exportJson(),
              "application/json",
            )
          }
        >
          {t("kbEgressLog.export")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!clearAllowed}
          aria-describedby={clearAllowed ? undefined : "kb-egress-locked"}
          onClick={async () => {
            await log.clear();
            await refresh();
          }}
        >
          {t("kbEgressLog.clear")}
        </Button>
      </div>
      {!clearAllowed && count !== undefined && (
        <p id="kb-egress-locked" className="text-xs text-muted-foreground">
          {t("kbEgressLog.clearLocked")}
        </p>
      )}
    </section>
  );
}
