import type {
  DomConfigPartialSelectorRule,
  DomConfigReport,
} from "@apty/browser-runtime/apty/dom-config/index";
import { useTranslation } from "@apty/ui/i18n/context";
import type { I18nContextValue, TranslationKey } from "@apty/ui/i18n/types";
import { partialTable, pathOf } from "./copy-format";
import { CopyButton, Wrapped } from "./report-parts";

type Translate = I18nContextValue["t"];

const KEEPS_LABEL: Record<
  DomConfigPartialSelectorRule["keeps"],
  TranslationKey
> = {
  start: "domConfig.partial.keepsStart",
  end: "domConfig.partial.keepsEnd",
  middle: "domConfig.partial.keepsMiddle",
};

export function partialTableText(
  t: Translate,
  rules: DomConfigPartialSelectorRule[],
): string {
  return partialTable(rules, [
    t("domConfig.partial.attribute"),
    t("domConfig.partial.regex"),
    t("domConfig.partial.kept"),
    t("domConfig.partial.elements"),
    t("domConfig.table.pages"),
  ]);
}

function PartialItem({ rule }: { rule: DomConfigPartialSelectorRule }) {
  const { t } = useTranslation();
  return (
    <li className="space-y-1 rounded-md border p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
        <code className="rounded-sm border bg-muted px-1 py-0.5 font-mono text-foreground">
          {rule.attribute}
        </code>
        <code className="min-w-0 rounded-sm border bg-background px-1 py-0.5 font-mono text-foreground [overflow-wrap:anywhere]">
          {rule.pattern}
        </code>
        <CopyButton
          text={rule.pattern}
          what={t("domConfig.partial.regexOf", { attribute: rule.attribute })}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(KEEPS_LABEL[rule.keeps])}{" "}
        {t("domConfig.partial.elementCount", { count: rule.elementCount })}
        {rule.exampleParts.length > 0 &&
          ` ${t("domConfig.partial.examples", { parts: rule.exampleParts.join(", ") })}`}
      </p>
      <p className="text-xs text-foreground">
        <Wrapped>{rule.reason}</Wrapped>
      </p>
      <p className="text-xs text-muted-foreground">
        <Wrapped>
          {t("domConfig.rules.pages", {
            pages: rule.pages.map(pathOf).join(", "),
          })}
        </Wrapped>
      </p>
    </li>
  );
}

/** Partial Selector conditions, one row per attribute and pattern, as Apty's editor holds them. */
export function PartialSelectorsView({ report }: { report: DomConfigReport }) {
  const { t } = useTranslation();
  const rules = report.partialSelectors;
  return (
    <section aria-label={t("domConfig.partial.title")} className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h4 className="text-xs font-semibold text-foreground">
          {t("domConfig.partial.title")}
        </h4>
        {rules.length > 0 && (
          <CopyButton
            text={partialTableText(t, rules)}
            what={t("domConfig.partial.title")}
            label={t("domConfig.copyTable")}
            ariaLabel={t("domConfig.copyTableAria", {
              section: t("domConfig.partial.title"),
            })}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("domConfig.partial.hint")}
      </p>
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("domConfig.partial.none")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <PartialItem key={rule.id} rule={rule} />
          ))}
        </ul>
      )}
    </section>
  );
}
