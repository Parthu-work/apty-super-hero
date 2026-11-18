/**
 * Options → General → Feedback (KB-RAG K25, L3): the wrong-card marks and
 * case outcomes on this device, exported for the KB owner as a tracking
 * sheet (CSV) or as questions for kb:eval, each reviewed in the dialog
 * before Copy or Download. The SE's questions go in only when they tick
 * "Include my question". Clear is off while a policy is set, like the K22
 * record. Nothing is sent.
 */

import {
  type CaseRecord,
  type PilotMeasures,
  pilotMeasures,
  pilotMeasuresCsv,
} from "@apty/agent-core";
import {
  feedbackCsv,
  feedbackQuestions,
  feedbackSynonymProposals,
} from "@apty/browser-runtime/case/feedback-store";
import { loadOrgPolicy } from "@apty/browser-runtime/runtime/org-policy";
import type { FeedbackRow } from "@apty/browser-runtime/storage/case-store";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { useTranslation } from "@apty/ui/i18n/context";
import { MessageSquareWarning } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { caseStore } from "../../services/cases";
import { loadKbCatalog } from "../../services/kb-cards";
import { BundleReviewDialog } from "../investigation/bundle-review-dialog";

type Export = {
  kind: "csv" | "questions" | "measures" | "synonyms";
  text: string;
} | null;

const EXPORTS = {
  csv: {
    filename: "apty-kb-feedback",
    extension: "csv",
    descriptionKey: "feedback.csvDescription",
    labelKey: "feedback.csvLabel",
  },
  questions: {
    filename: "apty-kb-questions",
    extension: "json",
    descriptionKey: "feedback.questionsDescription",
    labelKey: "feedback.questionsLabel",
  },
  measures: {
    filename: "apty-pilot-measures",
    extension: "csv",
    descriptionKey: "feedback.measures.csvDescription",
    labelKey: "feedback.measures.csvLabel",
  },
  synonyms: {
    filename: "apty-kb-synonym-proposals",
    extension: "json",
    descriptionKey: "feedback.synonymsDescription",
    labelKey: "feedback.synonymsLabel",
  },
} as const;

/** K27, E7: the words SEs used that the right card lacks, for the KB owner to decide on. */
async function synonymsExport(
  rows: FeedbackRow[],
  includeQuestions: boolean,
  note: string,
): Promise<string> {
  const catalog = await loadKbCatalog();
  const proposals = feedbackSynonymProposals(rows, catalog.text, {
    includeQuestions,
  });
  return `${JSON.stringify(
    { kind: "apty-kb-synonym-proposals", note, proposals },
    null,
    2,
  )}\n`;
}

const MEASURE_COLUMNS = [
  "cases",
  "kbAnswered",
  "checkAnswered",
  "notCovered",
  "wrongCard",
  "resolved",
  "escalated",
] as const;

/** K27, R4: the pilot's counts by version, and the median time to a first verdict. */
function PilotMeasuresTable({ measures }: { measures: PilotMeasures[] }) {
  const { t } = useTranslation();
  if (measures.length === 0) return null;
  return (
    <div className="overflow-x-auto" data-testid="pilot-measures">
      <table className="w-full text-left text-sm">
        <caption className="pb-1 text-left text-sm font-medium text-foreground">
          {t("feedback.measures.title")}
        </caption>
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("feedback.measures.version")}
            </th>
            {MEASURE_COLUMNS.map((column) => (
              <th key={column} scope="col" className="py-1 pr-3 font-medium">
                {t(`feedback.measures.${column}`)}
              </th>
            ))}
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("feedback.measures.median")}
            </th>
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => (
            <tr key={m.version} className="border-t border-border">
              <th scope="row" className="py-1.5 pr-3 font-medium">
                {m.version}
              </th>
              {MEASURE_COLUMNS.map((column) => (
                <td key={column} className="py-1.5 pr-3">
                  {m[column]}
                </td>
              ))}
              <td className="py-1.5 pr-3">
                {m.medianSecondsToVerdict === null
                  ? "-"
                  : t("feedback.measures.seconds", {
                      seconds: m.medianSecondsToVerdict,
                    })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FeedbackCard() {
  const { t } = useTranslation();
  const checkboxId = useId();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [include, setInclude] = useState(false);
  const [locked, setLocked] = useState(true);
  const [exported, setExported] = useState<Export>(null);

  const reload = useCallback(() => {
    void caseStore()
      .feedback()
      .then(setRows)
      .catch(() => setRows([]));
    void Promise.resolve()
      .then(() => caseStore().list())
      .then((list) => setCases(list ?? []))
      .catch(() => setCases([]));
  }, []);

  useEffect(() => {
    reload();
    void loadOrgPolicy()
      .then((state) => setLocked(state.kind !== "none"))
      .catch(() => setLocked(true));
  }, [reload]);

  const day = new Date().toISOString().slice(0, 10);
  const shown = EXPORTS[exported?.kind ?? "csv"];
  const measures = pilotMeasures(
    cases,
    rows.filter((row) => row.rightCardId),
  );

  return (
    <Card id="feedback">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareWarning aria-hidden="true" className="h-5 w-5" />
          {t("feedback.title")}
        </CardTitle>
        <CardDescription>{t("feedback.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-foreground" data-testid="feedback-count">
          {t("feedback.count", { count: rows.length })}
        </p>
        <PilotMeasuresTable measures={measures} />
        <label className="flex items-center gap-2 text-sm" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={include}
            onChange={(event) => setInclude(event.target.checked)}
          />
          {t("feedback.includeQuestion")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() =>
              setExported({
                kind: "csv",
                text: feedbackCsv(
                  include ? rows : rows.map(({ question: _q, ...row }) => row),
                ),
              })
            }
          >
            {t("feedback.exportCsv")}
          </Button>
          <Button
            variant="secondary"
            disabled={rows.length === 0}
            onClick={() =>
              setExported({
                kind: "questions",
                text: `${JSON.stringify(
                  feedbackQuestions(rows, { includeQuestions: include }),
                  null,
                  2,
                )}\n`,
              })
            }
          >
            {t("feedback.exportQuestions")}
          </Button>
          <Button
            variant="secondary"
            disabled={measures.length === 0}
            onClick={() =>
              setExported({
                kind: "measures",
                text: pilotMeasuresCsv(measures),
              })
            }
          >
            {t("feedback.measures.export")}
          </Button>
          <Button
            variant="secondary"
            disabled={!include || rows.length === 0}
            onClick={() =>
              void synonymsExport(
                rows,
                include,
                t("feedback.synonymsNote"),
              ).then((text) => setExported({ kind: "synonyms", text }))
            }
          >
            {t("feedback.exportSynonyms")}
          </Button>
          <Button
            variant="danger"
            disabled={locked || rows.length === 0}
            onClick={() => void caseStore().clearFeedback().then(reload)}
          >
            {t("feedback.clear")}
          </Button>
        </div>
        {!include && rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("feedback.synonymsNeedQuestion")}
          </p>
        )}
        {locked && (
          <p className="text-xs text-muted-foreground">
            {t("feedback.clearLocked")}
          </p>
        )}
      </CardContent>
      <BundleReviewDialog
        json={exported?.text ?? null}
        filePrefix="apty-kb-feedback"
        filename={`${shown.filename}-${day}.${shown.extension}`}
        mediaType={shown.extension === "json" ? "application/json" : "text/csv"}
        descriptionKey={shown.descriptionKey}
        labelKey={shown.labelKey}
        onClose={() => setExported(null)}
      />
    </Card>
  );
}
