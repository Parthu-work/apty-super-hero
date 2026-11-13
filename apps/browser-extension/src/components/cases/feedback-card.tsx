/**
 * Options → General → Feedback (KB-RAG K25, L3): the wrong-card marks and
 * case outcomes on this device, exported for the KB owner as a tracking
 * sheet (CSV) or as questions for kb:eval, each reviewed in the dialog
 * before Copy or Download. The SE's questions go in only when they tick
 * "Include my question". Clear is off while a policy is set, like the K22
 * record. Nothing is sent.
 */
import {
  feedbackCsv,
  feedbackQuestions,
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
import { BundleReviewDialog } from "../investigation/bundle-review-dialog";

type Export = { kind: "csv" | "questions"; text: string } | null;

export function FeedbackCard() {
  const { t } = useTranslation();
  const checkboxId = useId();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [include, setInclude] = useState(false);
  const [locked, setLocked] = useState(true);
  const [exported, setExported] = useState<Export>(null);

  const reload = useCallback(() => {
    void caseStore()
      .feedback()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    reload();
    void loadOrgPolicy()
      .then((state) => setLocked(state.kind !== "none"))
      .catch(() => setLocked(true));
  }, [reload]);

  const day = new Date().toISOString().slice(0, 10);

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
            variant="danger"
            disabled={locked || rows.length === 0}
            onClick={() => void caseStore().clearFeedback().then(reload)}
          >
            {t("feedback.clear")}
          </Button>
        </div>
        {locked && (
          <p className="text-xs text-muted-foreground">
            {t("feedback.clearLocked")}
          </p>
        )}
      </CardContent>
      <BundleReviewDialog
        json={exported?.text ?? null}
        filePrefix="apty-kb-feedback"
        filename={
          exported?.kind === "csv"
            ? `apty-kb-feedback-${day}.csv`
            : `apty-kb-questions-${day}.json`
        }
        mediaType={exported?.kind === "csv" ? "text/csv" : "application/json"}
        descriptionKey={
          exported?.kind === "csv"
            ? "feedback.csvDescription"
            : "feedback.questionsDescription"
        }
        labelKey={
          exported?.kind === "csv"
            ? "feedback.csvLabel"
            : "feedback.questionsLabel"
        }
        onClose={() => setExported(null)}
      />
    </Card>
  );
}
