/**
 * The result of a check pack (an item not visible, the widget itself, the
 * logs, an item's element or the page's element selection),
 * from `run_diagnosis` or from a turn the agent answered without the model:
 * the verdict, each cause with its evidence, fix and KB card, the next check,
 * the checks in the card's order, and what the files cannot decide. Rule
 * names and file facts only; no raw conditions or URLs.
 */
import type {
  Cause,
  DiagnosisResult,
  GateResult,
  GateStatus,
  RuleId,
  VerdictStatus,
} from "@apty/browser-runtime";
import { DefaultToolDisplay } from "@apty/ui/components/chatbot";
import { StatusBadge, type StatusTone } from "@apty/ui/components/ui/badge";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import type { ToolDisplaySlotProps } from "@apty/ui/types";
import {
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  ExternalLinkIcon,
  InfoIcon,
  type LucideIcon,
} from "lucide-react";

const KB_PAGE = "https://apty.atlassian.net/wiki/spaces/JA/pages/";
const PACKS = new Set([
  "content-not-visible",
  "widget-not-visible",
  "logs-and-errors",
  "element-not-found",
  "page-readiness",
]);

function isDiagnosisResult(value: unknown): value is DiagnosisResult {
  const candidate = value as Partial<DiagnosisResult> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    PACKS.has(String(candidate.packId)) &&
    Array.isArray(candidate.gates) &&
    typeof candidate.verdict?.status === "string"
  );
}

const VERDICT_TONE: Record<VerdictStatus, StatusTone> = {
  cause_found: "danger",
  candidates: "warning",
  no_cause_in_data: "neutral",
  no_data: "warning",
  out_of_scope: "neutral",
};

const GATE_ICON: Record<GateStatus, { Icon: LucideIcon; className: string }> = {
  pass: { Icon: CircleCheckIcon, className: "text-success" },
  fail: { Icon: CircleXIcon, className: "text-destructive" },
  unknown: { Icon: CircleHelpIcon, className: "text-warning" },
  info: { Icon: InfoIcon, className: "text-muted-foreground" },
};

interface CauseKeys {
  summary: TranslationKey;
  fix: TranslationKey;
  /** Other wording for the same rule, chosen by the cause's `variant` param. */
  variants?: Record<string, { summary: TranslationKey; fix: TranslationKey }>;
}

const CAUSE_TEXT: Partial<Record<RuleId, CauseKeys>> = {
  "CNV-02": {
    summary: "checkPack.rule.CNV-02.summary",
    fix: "checkPack.rule.CNV-02.fix",
  },
  "CNV-03": {
    summary: "checkPack.rule.CNV-03.summary",
    fix: "checkPack.rule.CNV-03.fix",
  },
  "CNV-04": {
    summary: "checkPack.rule.CNV-04.summary",
    fix: "checkPack.rule.CNV-04.fix",
  },
  "CNV-05": {
    summary: "checkPack.rule.CNV-05.summary",
    fix: "checkPack.rule.CNV-05.fix",
  },
  "CNV-07": {
    summary: "checkPack.rule.CNV-07.summary",
    fix: "checkPack.rule.CNV-07.fix",
  },
  "CNV-08": {
    summary: "checkPack.rule.CNV-08.summary",
    fix: "checkPack.rule.CNV-08.fix",
  },
  "CNV-13": {
    summary: "checkPack.rule.CNV-13.summary",
    fix: "checkPack.rule.CNV-13.fix",
  },
  "WNV-01": {
    summary: "checkPack.rule.WNV-01.summary",
    fix: "checkPack.rule.WNV-01.fix",
  },
  "WNV-02": {
    summary: "checkPack.rule.WNV-02.summary",
    fix: "checkPack.rule.WNV-02.fix",
  },
  "WNV-03": {
    summary: "checkPack.rule.WNV-03.summary",
    fix: "checkPack.rule.WNV-03.fix",
  },
  "WNV-07": {
    summary: "checkPack.rule.WNV-07.summary",
    fix: "checkPack.rule.WNV-07.fix",
    variants: {
      noneChosen: {
        summary: "checkPack.rule.WNV-07-noneChosen.summary",
        fix: "checkPack.rule.WNV-07-noneChosen.fix",
      },
    },
  },
  "LOG-01": {
    summary: "checkPack.rule.LOG-01.summary",
    fix: "checkPack.rule.LOG-01.fix",
  },
  "LOG-02": {
    summary: "checkPack.rule.LOG-02.summary",
    fix: "checkPack.rule.LOG-02.fix",
  },
  "LOG-03": {
    summary: "checkPack.rule.LOG-03.summary",
    fix: "checkPack.rule.LOG-03.fix",
  },
  "LOG-04": {
    summary: "checkPack.rule.LOG-04.summary",
    fix: "checkPack.rule.LOG-04.fix",
  },
  "LOG-05": {
    summary: "checkPack.rule.LOG-05.summary",
    fix: "checkPack.rule.LOG-05.fix",
  },
  "LOG-06": {
    summary: "checkPack.rule.LOG-06.summary",
    fix: "checkPack.rule.LOG-06.fix",
  },
  "SEL-02": {
    summary: "checkPack.rule.SEL-02.summary",
    fix: "checkPack.rule.SEL-02.fix",
  },
  "SEL-04": {
    summary: "checkPack.rule.SEL-04.summary",
    fix: "checkPack.rule.SEL-04.fix",
  },
  "SEL-05": {
    summary: "checkPack.rule.SEL-05.summary",
    fix: "checkPack.rule.SEL-05.fix",
  },
  "SEL-06": {
    summary: "checkPack.rule.SEL-06.summary",
    fix: "checkPack.rule.SEL-06.fix",
  },
  "SEL-07": {
    summary: "checkPack.rule.SEL-07.summary",
    fix: "checkPack.rule.SEL-07.fix",
  },
  "SEL-08": {
    summary: "checkPack.rule.SEL-08.summary",
    fix: "checkPack.rule.SEL-08.fix",
  },
  "SEL-09": {
    summary: "checkPack.rule.SEL-09.summary",
    fix: "checkPack.rule.SEL-09.fix",
  },
  "SEL-10": {
    summary: "checkPack.rule.SEL-10.summary",
    fix: "checkPack.rule.SEL-10.fix",
  },
  "SEL-11": {
    summary: "checkPack.rule.SEL-11.summary",
    fix: "checkPack.rule.SEL-11.fix",
  },
  "SEL-12": {
    summary: "checkPack.rule.SEL-12.summary",
    fix: "checkPack.rule.SEL-12.fix",
    variants: {
      otherFrame: {
        summary: "checkPack.rule.SEL-12-otherFrame.summary",
        fix: "checkPack.rule.SEL-12-otherFrame.fix",
      },
    },
  },
  "SEL-13": {
    summary: "checkPack.rule.SEL-13.summary",
    fix: "checkPack.rule.SEL-13.fix",
  },
  "DOM-01": {
    summary: "checkPack.rule.DOM-01.summary",
    fix: "checkPack.rule.DOM-01.fix",
  },
  "DOM-03": {
    summary: "checkPack.rule.DOM-03.summary",
    fix: "checkPack.rule.DOM-03.fix",
  },
  "DOM-04": {
    summary: "checkPack.rule.DOM-04.summary",
    fix: "checkPack.rule.DOM-04.fix",
  },
  "DOM-05": {
    summary: "checkPack.rule.DOM-05.summary",
    fix: "checkPack.rule.DOM-05.fix",
  },
  "DOM-06": {
    summary: "checkPack.rule.DOM-06.summary",
    fix: "checkPack.rule.DOM-06.fix",
    variants: {
      ambiguous: {
        summary: "checkPack.rule.DOM-06-ambiguous.summary",
        fix: "checkPack.rule.DOM-06-ambiguous.fix",
      },
    },
  },
  "DOM-07": {
    summary: "checkPack.rule.DOM-07.summary",
    fix: "checkPack.rule.DOM-07.fix",
  },
};

type Translate = ReturnType<typeof useTranslation>["t"];

/** `t` that names a language by its code in the reader's language ("法语", not "French"). */
function useCheckText(): Translate {
  const { t, language } = useTranslation();
  return (key, params) => {
    if (typeof params?.code !== "string") return t(key, params);
    let name: string | undefined;
    try {
      name = new Intl.DisplayNames([language], { type: "language" }).of(
        params.code,
      );
    } catch {
      name = undefined;
    }
    return t(key, name ? { ...params, language: name } : params);
  };
}

const PART_KEY: Record<string, TranslationKey> = {
  own: "checkPack.part.own",
  disabled: "checkPack.part.disabled",
  step: "checkPack.part.step",
};

/** Which reader a log line came from, by the logs check's `source` param. */
const SOURCE_KEY: Record<string, TranslationKey> = {
  client: "checkPack.where.client",
  page: "checkPack.where.page",
};

/** Why something could not be read, by its failure code, so no English message reaches another language. */
const FAILURE_KEY: Record<string, TranslationKey> = {
  not_configured: "checkPack.failure.not_configured",
  no_receiver: "checkPack.failure.no_receiver",
  no_response: "checkPack.failure.no_response",
  timeout: "checkPack.failure.timeout",
  send_failed: "checkPack.failure.send_failed",
  malformed_response: "checkPack.failure.malformed_response",
  unreachable: "checkPack.failure.unreachable",
  no_page: "checkPack.failure.no_page",
  audit_error: "checkPack.failure.audit_error",
  no_frame_answered: "checkPack.failure.no_frame_answered",
};

/**
 * Names where on the item an element sits ("Step 2") or which reader a line
 * came from, for the strings that start with it, and why something could
 * not be read.
 */
function withWhere(t: Translate, params: GateResult["params"]) {
  const part = PART_KEY[String(params.part)];
  const source = SOURCE_KEY[String(params.source)];
  const failure =
    typeof params.failure === "string"
      ? (FAILURE_KEY[params.failure] ?? "checkPack.failure.other")
      : undefined;
  return {
    ...params,
    ...(part
      ? { where: t(part, { n: params.n ?? 1 }) }
      : source
        ? { where: t(source) }
        : {}),
    ...(failure ? { failureText: t(failure) } : {}),
  };
}

function gateText(t: Translate, gate: GateResult): string {
  return t(`checkPack.reason.${gate.reason}`, withWhere(t, gate.params));
}

function headline(t: Translate, result: DiagnosisResult, kind: string) {
  const { verdict, gates, scan } = result;
  const first = verdict.causes[0];
  if (first) return causeText(t, first, kind).summary;
  if (scan) {
    return t(
      scan.segmentsUnread
        ? "checkPack.scanSummaryNoSegments"
        : "checkPack.scanSummary",
      {
        blocked: scan.rows.filter((r) => r.blockers.length > 0).length,
        total: scan.total,
      },
    );
  }
  const several = gates.find((g) => g.reason === "severalMatch");
  if (several) return gateText(t, several);
  if (verdict.status === "candidates") return t("checkPack.summary.candidates");
  if (verdict.status === "no_cause_in_data") {
    return t("checkPack.summary.no_cause_in_data");
  }
  const failed = gates.find((g) => g.status === "fail");
  return failed ? gateText(t, failed) : t("checkPack.summary.out_of_scope");
}

function causeText(t: Translate, cause: Cause, kind: string) {
  const ruleKeys = CAUSE_TEXT[cause.ruleId];
  const variant = cause.params.variant;
  const keys =
    (typeof variant === "string" ? ruleKeys?.variants?.[variant] : undefined) ??
    ruleKeys;
  const params = { ...withWhere(t, cause.params), kind };
  return keys
    ? { summary: t(keys.summary, params), fix: t(keys.fix, params) }
    : { summary: cause.summary, fix: cause.fix };
}

function KbCardLink({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={`${KB_PAGE}${pageId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {t("checkPack.card")} {pageId}
      <ExternalLinkIcon aria-hidden="true" className="size-3" />
    </a>
  );
}

function CauseItem({ cause, kind }: { cause: Cause; kind: string }) {
  const t = useCheckText();
  const text = causeText(t, cause, kind);
  return (
    <li className="space-y-1.5 rounded-md border border-border bg-card p-2.5">
      <p className="text-sm font-medium text-foreground">{text.summary}</p>
      <p className="text-sm text-foreground">
        <span className="font-medium">{t("checkPack.fix")}: </span>
        {text.fix}
      </p>
      {cause.evidence.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground">
            {t("checkPack.evidence")}
          </p>
          <ul className="space-y-0.5">
            {cause.evidence.map((line) => (
              <li
                key={line}
                className="break-all font-mono text-xs text-foreground"
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{t("checkPack.ruleLabel", { ruleId: cause.ruleId })}</span>
        <KbCardLink pageId={cause.cardPageId} />
      </p>
    </li>
  );
}

function GateRow({ gate }: { gate: GateResult }) {
  const t = useCheckText();
  const { Icon, className } = GATE_ICON[gate.status];
  return (
    <li className="flex items-start gap-2 py-1">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4", className)} />
      <span className="min-w-0 text-sm">
        <span className="font-medium text-foreground">
          {t(`checkPack.gate.${gate.id}`)}
        </span>
        <span className="sr-only">
          {" "}
          ({t(`checkPack.gateStatus.${gate.status}`)})
        </span>
        <span className="text-muted-foreground"> {gateText(t, gate)}</span>
      </span>
    </li>
  );
}

export function CheckResultCard(props: ToolDisplaySlotProps) {
  const t = useCheckText();
  const result = props.tool.output;
  if (!isDiagnosisResult(result)) return <DefaultToolDisplay {...props} />;

  const { verdict, subject, scan } = result;
  const kind = t(`checkPack.kind.${subject.kind}`);
  const title =
    result.packId === "page-readiness"
      ? t("checkPack.titlePage")
      : result.packId === "element-not-found"
        ? subject.query
          ? t("checkPack.titleElement", { name: subject.name ?? subject.query })
          : t("checkPack.titleElementGeneric")
        : subject.kind === "logs"
          ? t("checkPack.titleLogs")
          : subject.kind === "widget"
            ? t("checkPack.titleWidget")
            : scan
              ? t("checkPack.titleScan", { kind })
              : subject.query
                ? t("checkPack.titleItem", {
                    name: subject.name ?? subject.query,
                  })
                : t("checkPack.titleGeneric");
  const blockedRows = scan?.rows.filter((r) => r.blockers.length > 0) ?? [];
  const several = subject.matched.length > 1;

  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium text-foreground">{title}</h3>
        <StatusBadge tone={VERDICT_TONE[verdict.status]}>
          {t(`checkPack.status.${verdict.status}`)}
        </StatusBadge>
      </div>

      <p className="text-sm text-foreground">{headline(t, result, kind)}</p>

      {verdict.causes.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("checkPack.causes")}
          </h4>
          <ul className="space-y-2">
            {verdict.causes.map((cause, index) => (
              <CauseItem
                key={`${cause.ruleId}-${index}`}
                cause={cause}
                kind={kind}
              />
            ))}
          </ul>
        </div>
      )}

      {several && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("checkPack.matches")}
          </h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {subject.matched.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {blockedRows.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {blockedRows.map((row) => (
            <li
              key={row.sourceId}
              className="flex flex-wrap justify-between gap-x-3 px-2.5 py-1.5 text-sm"
            >
              <span className="font-medium text-foreground">{row.name}</span>
              <span className="text-muted-foreground">
                {row.blockers
                  .map((b) => t(`checkPack.blocker.${b}`))
                  .join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {verdict.nextCheck && (
        <p className="text-sm text-foreground">
          <span className="font-medium">{t("checkPack.nextCheck")}: </span>
          {t(`checkPack.next.${verdict.nextCheck}`)}
        </p>
      )}

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">
          {t("checkPack.checks")}
        </h4>
        <ul>
          {result.gates.map((gate, index) => (
            <GateRow key={`${gate.id}-${gate.reason}-${index}`} gate={gate} />
          ))}
        </ul>
      </div>

      {result.notChecked.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("checkPack.notChecked.title")}
          </h4>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {result.notChecked.map((item) => (
              <li key={item}>{t(`checkPack.notChecked.${item}`)}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{t("checkPack.provenance")}</span>
        <KbCardLink pageId={result.cardPageId} />
      </p>
    </section>
  );
}
