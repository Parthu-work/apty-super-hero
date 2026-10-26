import type {
  DomConfigReport,
  DomConfigRule,
} from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import { type ReactNode, useId } from "react";
import {
  conditionText,
  isRuleIncluded,
  pathOf,
  type RuleChoices,
  rulesTable,
} from "./copy-format";
import {
  CopyButton,
  EvidenceBadge,
  evidenceLabel,
  Wrapped,
} from "./report-parts";

type Translate = I18nContextValue["t"];

export const TARGET_LABEL: Record<DomConfigRule["target"], TranslationKey> = {
  id: "domConfig.rules.id",
  class: "domConfig.rules.class",
  "attribute-name": "domConfig.rules.attributeName",
  "attribute-value": "domConfig.rules.attributeValue",
};

export function ruleTableText(t: Translate, rules: DomConfigRule[]): string {
  return rulesTable(rules, {
    header: [
      t("domConfig.table.conditions"),
      t("domConfig.table.evidence"),
      t("domConfig.table.reason"),
      t("domConfig.table.pages"),
      t("domConfig.table.valuesCovered"),
      t("domConfig.table.examples"),
    ],
    and: t("domConfig.rules.and"),
    evidence: (rule) => evidenceLabel(t, rule.evidence),
  });
}

function RuleItem({
  rule,
  included,
  onToggle,
}: {
  rule: DomConfigRule;
  included: boolean;
  onToggle: (included: boolean) => void;
}) {
  const { t } = useTranslation();
  const and = t("domConfig.rules.and");
  const text = conditionText(rule, and);
  return (
    <li
      className={cn(
        "space-y-1 rounded-md border p-2",
        !included && "border-dashed",
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={included}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={t("domConfig.rules.include", { rule: text })}
          className="mt-1 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs">
          {rule.conditions.map((condition, i) => (
            <span
              key={`${condition.category}-${condition.operator}-${condition.value}`}
              className="flex min-w-0 flex-wrap items-center gap-1"
            >
              {i > 0 && (
                <span className="font-semibold text-muted-foreground">
                  {and}
                </span>
              )}
              <span className="rounded-sm border bg-muted px-1 py-0.5 text-foreground">
                {condition.category}
              </span>
              <span className="rounded-sm border bg-muted px-1 py-0.5 text-foreground">
                {condition.operator}
              </span>
              <code className="min-w-0 rounded-sm border bg-background px-1 py-0.5 font-mono text-foreground [overflow-wrap:anywhere]">
                {condition.value}
              </code>
              <CopyButton
                text={condition.value}
                what={t("domConfig.rules.value", { value: condition.value })}
              />
            </span>
          ))}
        </div>
        <CopyButton text={text} what={t("domConfig.rules.rule")} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs text-muted-foreground">
        <EvidenceBadge evidence={rule.evidence} />
        <span>
          {t("domConfig.rules.valuesCovered", {
            count: rule.coveredValueCount,
          })}
        </span>
      </div>
      <p className="pl-5 text-xs text-foreground">
        <Wrapped>{rule.reason}</Wrapped>
      </p>
      <p className="pl-5 text-xs text-muted-foreground">
        <Wrapped>
          {t("domConfig.rules.pages", {
            pages: rule.pages.map(pathOf).join(", "),
          })}
        </Wrapped>
      </p>
    </li>
  );
}

function RuleList({
  rules,
  choices,
  onChoice,
}: {
  rules: DomConfigRule[];
  choices: RuleChoices;
  onChoice: (ruleId: string, included: boolean) => void;
}) {
  const { t } = useTranslation();
  if (rules.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("domConfig.rules.none")}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {rules.map((rule) => (
        <RuleItem
          key={rule.id}
          rule={rule}
          included={isRuleIncluded(rule, choices)}
          onToggle={(included) => onChoice(rule.id, included)}
        />
      ))}
    </ul>
  );
}

function Section({
  title,
  copyText,
  children,
}: {
  title: string;
  copyText: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={title} className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <CopyButton
          text={copyText}
          what={title}
          label={t("domConfig.copyTable")}
          ariaLabel={t("domConfig.copyTableAria", { section: title })}
        />
      </div>
      {children}
    </section>
  );
}

export function RulesView({
  report,
  choices,
  onChoice,
  onIncludeReview,
  onIncludeRecordSpecific,
}: {
  report: DomConfigReport;
  choices: RuleChoices;
  onChoice: (ruleId: string, included: boolean) => void;
  onIncludeReview: (include: boolean) => void;
  onIncludeRecordSpecific: (include: boolean) => void;
}) {
  const { t } = useTranslation();
  const switchId = useId();
  const included = (rules: DomConfigRule[]) =>
    rules.filter((rule) => isRuleIncluded(rule, choices));
  const main = report.rules.filter((r) => r.group === "main");
  const review = report.rules.filter((r) => r.group === "review");
  const record = report.rules.filter((r) => r.group === "record-specific");

  return (
    <div className="space-y-3 text-xs">
      <p className="text-xs text-muted-foreground">
        {t("domConfig.rules.assumption")}
      </p>
      {(Object.keys(TARGET_LABEL) as DomConfigRule["target"][]).map(
        (target) => {
          const rules = main.filter((r) => r.target === target);
          return (
            <Section
              key={target}
              title={t(TARGET_LABEL[target])}
              copyText={ruleTableText(t, included(rules))}
            >
              <RuleList rules={rules} choices={choices} onChoice={onChoice} />
            </Section>
          );
        },
      )}

      <details className="rounded-md border px-2 py-1.5">
        <summary className="cursor-pointer font-medium text-foreground">
          {t("domConfig.rules.review", { count: review.length })}
        </summary>
        <div className="mt-1.5 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {t("domConfig.rules.reviewHint")}
          </p>
          <label className="flex items-center gap-2 text-foreground">
            <input
              type="checkbox"
              checked={choices.includeReview}
              onChange={(e) => onIncludeReview(e.target.checked)}
            />
            <span>{t("domConfig.rules.includeAllReview")}</span>
          </label>
          <Section
            title={t("domConfig.rules.review", { count: review.length })}
            copyText={ruleTableText(t, included(review))}
          >
            <RuleList rules={review} choices={choices} onChoice={onChoice} />
          </Section>
        </div>
      </details>

      <div className="space-y-1.5 rounded-md border px-2 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span id={switchId} className="font-medium text-foreground">
            {t("domConfig.rules.recordSwitch")}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={choices.includeRecordSpecific}
            aria-labelledby={switchId}
            onClick={() =>
              onIncludeRecordSpecific(!choices.includeRecordSpecific)
            }
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
              choices.includeRecordSpecific ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block size-3.5 rounded-full bg-background shadow transition-transform motion-reduce:transition-none",
                choices.includeRecordSpecific
                  ? "translate-x-4"
                  : "translate-x-0.5",
              )}
            />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("domConfig.rules.recordHint")}{" "}
          {t("domConfig.rules.recordCount", { count: record.length })}
        </p>
        {choices.includeRecordSpecific && (
          <Section
            title={t("domConfig.rules.recordSwitch")}
            copyText={ruleTableText(t, included(record))}
          >
            <RuleList rules={record} choices={choices} onChoice={onChoice} />
          </Section>
        )}
      </div>

      <details className="rounded-md border px-2 py-1.5">
        <summary className="cursor-pointer font-medium text-foreground">
          {t("domConfig.rules.coveredByDefaults", {
            count: report.coveredByDefaults.length,
          })}
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("domConfig.rules.coveredAssumption")}
        </p>
        <ul className="mt-1 space-y-1">
          {report.coveredByDefaults.map((item) => (
            <li
              key={`${item.target}-${item.name}-${item.generalized ?? ""}`}
              className="text-xs text-foreground"
            >
              <code className="font-mono [overflow-wrap:anywhere]">
                {item.name}
                {item.generalized ? ` ${item.generalized}` : ""}
              </code>{" "}
              · {t("domConfig.rules.defaultRule", { rule: item.defaultRule })} ·{" "}
              {t("domConfig.rules.valueCount", { count: item.valueCount })}
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-md border px-2 py-1.5">
        <summary className="cursor-pointer font-medium text-foreground">
          {t("domConfig.rules.manualReview", {
            count: report.manualReview.length,
          })}
        </summary>
        <ul className="mt-1 space-y-1">
          {report.manualReview.map((item) => (
            <li
              key={`${item.target}-${item.name}-${item.reason}`}
              className="text-xs text-foreground"
            >
              <code className="font-mono [overflow-wrap:anywhere]">
                {item.name}
              </code>{" "}
              · <Wrapped>{item.reason}</Wrapped> ·{" "}
              {t("domConfig.rules.valueCount", { count: item.valueCount })}
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-md border px-2 py-1.5">
        <summary className="cursor-pointer font-medium text-foreground">
          {t("domConfig.rules.rejected", {
            count: report.rejectedRules.length,
          })}
        </summary>
        <ul className="mt-1 space-y-1">
          {report.rejectedRules.map((item) => (
            <li key={item.rule.id} className="text-xs text-foreground">
              <code className="font-mono [overflow-wrap:anywhere]">
                {conditionText(item.rule, t("domConfig.rules.and"))}
              </code>{" "}
              · <Wrapped>{item.reason}</Wrapped>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
