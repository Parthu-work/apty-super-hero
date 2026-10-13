import type { RequestReport } from "@apty/agent-core";
import { useTranslation } from "../../i18n/context";

const MODE_LABELS: Record<string, { en: string; zh: string }> = {
  strict: { en: "Strict", zh: "严格" },
  standard: { en: "Standard", zh: "标准" },
  off: { en: "Off", zh: "关闭" },
};

function n(value: number): string {
  return value.toLocaleString("en-US");
}

function describeReport(report: RequestReport, zh: boolean) {
  const mode = MODE_LABELS[report.redactionMode] ?? {
    en: report.redactionMode,
    zh: report.redactionMode,
  };
  const results = zh
    ? `${report.toolResults} 个结果，${report.toolResultsStubbed} 个摘要，${report.toolResultsCut} 个截断`
    : `${report.toolResults} results, ${report.toolResultsStubbed} stubbed, ${report.toolResultsCut} cut`;
  const parts = zh
    ? [
        `系统提示 ${n(report.systemPromptTokens)}`,
        `${report.toolCount} 个工具 ${n(report.toolSchemaTokens)}`,
        `历史 ${n(report.historyTokens)}`,
        `工具结果 ${n(report.toolResultTokens)}（${results}）`,
      ]
    : [
        `system prompt ${n(report.systemPromptTokens)}`,
        `${report.toolCount} tools ${n(report.toolSchemaTokens)}`,
        `history ${n(report.historyTokens)}`,
        `tool results ${n(report.toolResultTokens)} (${results})`,
      ];
  if (report.images > 0) {
    parts.push(
      zh
        ? `${report.images} 张截图`
        : `${report.images} screenshot${report.images === 1 ? "" : "s"}`,
    );
  }
  return {
    time: new Date(report.at).toLocaleTimeString(),
    total: zh
      ? `约 ${n(report.totalTokens)} 个 token`
      : `about ${n(report.totalTokens)} tokens`,
    mode: zh ? mode.zh : mode.en,
    parts: parts.join(" · "),
  };
}

/** The last requests sent to the AI provider: sizes and counts only, never content. */
export function RecentRequests({ reports }: { reports: RequestReport[] }) {
  const zh = useTranslation().language === "zh";
  return (
    <section className="space-y-2" aria-labelledby="recent-requests-title">
      <h3 id="recent-requests-title" className="text-sm font-medium">
        {zh ? "最近的请求" : "Recent requests"}
      </h3>
      <p className="text-xs text-muted-foreground">
        {zh
          ? "本次浏览器会话中最近 5 次发送给 AI 服务商的请求：只有大小（按字符数 / 4 估算的 token）和计数，不含任何内容。"
          : "The last 5 requests sent to your AI provider in this browser session: sizes (tokens estimated as characters / 4) and counts only, never their content."}
      </p>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {zh ? "尚未发送任何请求。" : "No requests sent yet."}
        </p>
      ) : (
        <ul aria-label="Recent requests" className="space-y-1">
          {reports.map((report) => {
            const row = describeReport(report, zh);
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
