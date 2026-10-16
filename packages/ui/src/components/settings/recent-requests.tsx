import type { RequestReport } from "@apty/agent-core";
import { useTranslation } from "../../i18n/context";
import type { I18nContextValue, TranslationKey } from "../../i18n/types";

const MODE_LABELS: Record<string, TranslationKey> = {
  strict: "recentRequests.mode.strict",
  standard: "recentRequests.mode.standard",
  off: "recentRequests.mode.off",
};

function n(value: number): string {
  return value.toLocaleString("en-US");
}

function describeReport(report: RequestReport, t: I18nContextValue["t"]) {
  const modeKey = MODE_LABELS[report.redactionMode];
  const results = t("recentRequests.results", {
    results: report.toolResults,
    stubbed: report.toolResultsStubbed,
    cut: report.toolResultsCut,
  });
  const parts = [
    t("recentRequests.systemPrompt", { tokens: n(report.systemPromptTokens) }),
    t("recentRequests.tools", {
      count: report.toolCount,
      tokens: n(report.toolSchemaTokens),
    }),
    t("recentRequests.history", { tokens: n(report.historyTokens) }),
    t("recentRequests.toolResults", {
      tokens: n(report.toolResultTokens),
      results,
    }),
  ];
  if (report.images > 0) {
    parts.push(
      t(
        report.images === 1
          ? "recentRequests.screenshotOne"
          : "recentRequests.screenshotMany",
        { count: report.images },
      ),
    );
  }
  return {
    time: new Date(report.at).toLocaleTimeString(),
    total: t("recentRequests.total", { tokens: n(report.totalTokens) }),
    mode: modeKey ? t(modeKey) : report.redactionMode,
    parts: parts.join(" · "),
  };
}

/** The last requests sent to the AI provider: sizes and counts only, never content. */
export function RecentRequests({ reports }: { reports: RequestReport[] }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" aria-labelledby="recent-requests-title">
      <h3 id="recent-requests-title" className="text-sm font-medium">
        {t("recentRequests.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t("recentRequests.description")}
      </p>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("recentRequests.none")}
        </p>
      ) : (
        <ul aria-label={t("recentRequests.title")} className="space-y-1">
          {reports.map((report) => {
            const row = describeReport(report, t);

            return (
              <li key={report.at} className="rounded-md border p-2 text-xs">
                <p className="font-medium">
                  {row.time} · {row.total} · {row.mode}
                </p>
                <p className="text-muted-foreground">{row.parts}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
