/**
 * Options → General → Cases (KB-RAG K25, L1): every case on this device,
 * newest first, with its id, date, version, symptom and outcome; open one
 * to see its record (ids, numbers and codes), delete one, or delete all.
 * Nothing here leaves the browser until the SE copies or downloads it.
 */
import { type CaseRecord, caseRetentionDays } from "@apty/agent-core";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { useTranslation } from "@apty/ui/i18n/context";
import { FolderOpen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { caseStore } from "../../services/cases";

function CaseDetails({
  record,
  onClose,
  actions,
}: {
  record: CaseRecord;
  onClose: () => void;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const none = t("cases.details.none");
  return (
    <section
      aria-label={record.id}
      className="space-y-2 rounded-md border border-border p-3 text-sm"
      data-testid="case-details"
    >
      <h3 className="font-mono font-medium text-foreground">{record.id}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("cases.columns.outcome")}</dt>
        <dd>{t(`cases.outcome.${record.outcome}`)}</dd>
        <dt className="text-muted-foreground">{t("cases.columns.version")}</dt>
        <dd>
          {record.aptyVersion ?? none}
          {record.versionSource ? ` (${record.versionSource})` : ""}
        </dd>
        <dt className="text-muted-foreground">{t("cases.details.checks")}</dt>
        <dd>
          {record.checks.length
            ? record.checks
                .map((c) => `${c.packId}: ${c.status} ${c.ruleIds.join(", ")}`)
                .join("; ")
            : none}
        </dd>
        <dt className="text-muted-foreground">{t("cases.details.finding")}</dt>
        <dd>
          {record.finding
            ? [
                record.finding.ruleId,
                record.finding.cardPageId,
                record.finding.confidence,
                record.finding.verification,
              ]
                .filter(Boolean)
                .join(" · ")
            : none}
        </dd>
        <dt className="text-muted-foreground">{t("cases.details.kbShown")}</dt>
        <dd>
          {record.kbShown.length
            ? record.kbShown
                .flatMap((shown) =>
                  shown.cards.map((c) =>
                    c.layer ? `${c.pageId}#L${c.layer}` : c.pageId,
                  ),
                )
                .join(", ")
            : none}
        </dd>
        <dt className="text-muted-foreground">
          {t("cases.details.decisions")}
        </dt>
        <dd>{record.decisions.map((d) => d.route).join(", ") || none}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        {actions}
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("cases.details.close")}
        </Button>
      </div>
    </section>
  );
}

export function CasesCard({
  detailActions,
}: {
  /** What a case's details offer besides Close: the support bundle (L2). */
  detailActions?: (record: CaseRecord) => ReactNode;
}) {
  const { t } = useTranslation();
  const [cases, setCases] = useState<CaseRecord[] | undefined>();
  const [days, setDays] = useState(90);
  const [opened, setOpened] = useState<string | undefined>();
  const [confirmAll, setConfirmAll] = useState(false);

  const reload = useCallback(() => {
    void caseStore()
      .prune()
      .then(() => caseStore().list())
      .then(setCases)
      .catch(() => setCases([]));
  }, []);

  useEffect(() => {
    reload();
    void loadOrgPolicy()
      .then((state) => setDays(caseRetentionDays(state)))
      .catch(() => undefined);
  }, [reload]);

  const open = cases?.find((record) => record.id === opened);

  return (
    <Card id="cases">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen aria-hidden="true" className="h-5 w-5" />
          {t("cases.title")}
        </CardTitle>
        <CardDescription>{t("cases.description", { days })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {cases && cases.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("cases.empty")}</p>
        )}
        {cases && cases.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("cases.columns.id")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("cases.columns.date")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("cases.columns.version")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("cases.columns.symptom")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("cases.columns.outcome")}
                  </th>
                  <th scope="col" className="sr-only">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {cases.map((record) => (
                  <tr key={record.id} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-mono">{record.id}</td>
                    <td className="py-1.5 pr-3">
                      {record.createdAt.slice(0, 10)}
                    </td>
                    <td className="py-1.5 pr-3">{record.aptyVersion ?? "-"}</td>
                    <td className="max-w-48 truncate py-1.5 pr-3">
                      {record.symptom ?? "-"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {t(`cases.outcome.${record.outcome}`)}
                    </td>
                    <td className="py-1.5">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={t("cases.open", { id: record.id })}
                          onClick={() => setOpened(record.id)}
                        >
                          {t("common.open")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("cases.delete", { id: record.id })}
                          onClick={() => {
                            void caseStore().delete(record.id).then(reload);
                            if (opened === record.id) setOpened(undefined);
                          }}
                        >
                          {t("common.delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open && (
          <CaseDetails
            record={open}
            onClose={() => setOpened(undefined)}
            actions={detailActions?.(open)}
          />
        )}
        {cases && cases.length > 0 && (
          <Button variant="danger" onClick={() => setConfirmAll(true)}>
            {t("cases.deleteAll")}
          </Button>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t("cases.deleteAll")}
        description={t("cases.deleteAllConfirm")}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          setConfirmAll(false);
          setOpened(undefined);
          void caseStore().deleteAll().then(reload);
        }}
      />
    </Card>
  );
}
