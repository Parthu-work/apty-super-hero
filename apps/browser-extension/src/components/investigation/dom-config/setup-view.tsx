import { Badge } from "@apty/ui/components/ui/badge";
import { Button } from "@apty/ui/components/ui/button";
import { Input } from "@apty/ui/components/ui/input";
import { ListRow } from "@apty/ui/components/ui/list-row";
import { Notice } from "@apty/ui/components/ui/notice";
import {
  OptionCard,
  OptionCardGroup,
} from "@apty/ui/components/ui/option-card";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { cn } from "@apty/ui/lib/utils";
import {
  CameraIcon,
  ChevronDownIcon,
  FileInputIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { navigationStore } from "../../../state/navigation-store";
import type { DomConfigScope, DomConfigStartOptions } from "./dom-config-store";

export const SCOPE_LABEL: Record<DomConfigScope, TranslationKey> = {
  page: "domConfig.page.scopePage",
  "application-safe": "domConfig.page.scopeSafe",
  "application-deep": "domConfig.page.scopeDeep",
};

const SCOPES: {
  value: DomConfigScope;
  description: TranslationKey;
  recommended?: true;
}[] = [
  { value: "page", description: "domConfig.page.scopePageBody" },
  {
    value: "application-safe",
    description: "domConfig.page.scopeSafeBody",
    recommended: true,
  },
  { value: "application-deep", description: "domConfig.page.scopeDeepBody" },
];

const SELECT =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** "2 runs per page · 20 pages · 10 min · probe on", from the current options. */
function advancedSummary(
  t: ReturnType<typeof useTranslation>["t"],
  options: DomConfigStartOptions,
): string {
  const pages = options.scope === "page" ? 1 : options.maxPages;
  return [
    t("domConfig.page.runsPerPage", { count: options.runsPerState }),
    t(
      pages === 1 ? "domConfig.page.pageCountOne" : "domConfig.page.pageCount",
      { count: pages },
    ),
    t("domConfig.page.minutes", { count: options.maxMinutes }),
    t(options.probe ? "domConfig.page.probeOn" : "domConfig.page.probeOff"),
  ].join(" · ");
}

function AdvancedOptions({
  options,
  onChange,
}: {
  options: DomConfigStartOptions;
  onChange: (options: Partial<DomConfigStartOptions>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <ListRow
        icon={<SlidersHorizontalIcon />}
        label={t("domConfig.page.advanced")}
        description={advancedSummary(t, options)}
        aria-expanded={open}
        aria-controls={`${id}-advanced`}
        trailing={
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        }
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div id={`${id}-advanced`} className="grid gap-4 px-3 pt-2 pb-1">
          <div className="space-y-1.5">
            <label
              htmlFor={`${id}-runs`}
              className="block text-sm font-medium text-foreground"
            >
              {t("domConfig.options.runsPerPage")}
            </label>
            <select
              id={`${id}-runs`}
              value={options.runsPerState}
              onChange={(e) =>
                onChange({ runsPerState: Number(e.target.value) as 2 | 3 | 4 })
              }
              className={SELECT}
            >
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor={`${id}-pages`}
                className="block text-sm font-medium text-foreground"
              >
                {t("domConfig.options.maxPages")}
              </label>
              <Input
                id={`${id}-pages`}
                type="number"
                min={1}
                max={200}
                value={options.scope === "page" ? 1 : options.maxPages}
                disabled={options.scope === "page"}
                onChange={(e) =>
                  onChange({
                    maxPages: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`${id}-minutes`}
                className="block text-sm font-medium text-foreground"
              >
                {t("domConfig.options.maxMinutes")}
              </label>
              <Input
                id={`${id}-minutes`}
                type="number"
                min={1}
                max={60}
                value={options.maxMinutes}
                onChange={(e) =>
                  onChange({
                    maxMinutes: Math.max(1, Number(e.target.value) || 1),
                  })
                }
              />
            </div>
          </div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={options.probe}
              onChange={(e) => onChange({ probe: e.target.checked })}
              className="mt-0.5 size-4 shrink-0 accent-info"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                {t("domConfig.page.probeLabel")}
              </span>
              <span className="block text-small text-muted-foreground">
                {t("domConfig.page.probeBody")}
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

/** "Or capture by hand": the manual capture and import sub-views. */
export function ByHandRows({ caption }: { caption: TranslationKey }) {
  const { t } = useTranslation();
  return (
    <section className="mt-6 space-y-1">
      <h3 className="px-3 text-xs font-medium text-muted-foreground">
        {t(caption)}
      </h3>
      <ListRow
        icon={<CameraIcon />}
        label={t("domConfig.manual.title")}
        chevron
        onClick={() => navigationStore.openSubView("capture")}
      />
      <ListRow
        icon={<FileInputIcon />}
        label={t("domConfig.page.importRuns")}
        chevron
        onClick={() => navigationStore.openSubView("import")}
      />
    </section>
  );
}

/**
 * What a capture covers and how, before it starts: scope, the advanced
 * limits and, for this page, the ways to capture by hand.
 */
export function SetupBody({
  options,
  onChange,
  byHand,
}: {
  options: DomConfigStartOptions;
  onChange: (options: Partial<DomConfigStartOptions>) => void;
  byHand?: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [whatOpen, setWhatOpen] = useState(false);
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {t("domConfig.page.intro")}
      </p>
      <button
        type="button"
        aria-expanded={whatOpen}
        aria-controls={`${id}-what`}
        onClick={() => setWhatOpen((open) => !open)}
        className="mt-1 text-sm font-medium text-info underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t("domConfig.page.whatItProposes")}
      </button>
      {whatOpen && (
        <p id={`${id}-what`} className="mt-1 text-sm text-foreground">
          {t("domConfig.page.proposes")}
        </p>
      )}
      <fieldset className="mt-4 space-y-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          {t("domConfig.options.scope")}
        </legend>
        <OptionCardGroup>
          {SCOPES.map((scope) => (
            <OptionCard
              key={scope.value}
              name={`${id}-scope`}
              value={scope.value}
              checked={options.scope === scope.value}
              onChange={() => onChange({ scope: scope.value })}
              title={t(SCOPE_LABEL[scope.value])}
              description={t(scope.description)}
              badge={
                scope.recommended ? (
                  <Badge variant="info">
                    {t("domConfig.page.recommended")}
                  </Badge>
                ) : undefined
              }
            />
          ))}
        </OptionCardGroup>
      </fieldset>
      <div className="mt-2">
        <AdvancedOptions options={options} onChange={onChange} />
      </div>
      {byHand}
    </div>
  );
}

/**
 * Start's footer: the notice for the scope (correction 5), the deep-mode
 * confirmation, Start, and the inline "replace held pages" question.
 */
export function StartFooter({
  options,
  startLabel,
  disabledReason,
  disabledId,
  replaceCount,
  onStart,
}: {
  options: DomConfigStartOptions;
  startLabel: TranslationKey;
  /** Why Start is not available; null when it is. */
  disabledReason: string | null;
  /** The notice that says why, for `aria-describedby`. */
  disabledId: string;
  /** Pages captured by hand or imported, which a new crawl replaces. */
  replaceCount: number;
  /** `replace` once the SE has confirmed that the held pages go. */
  onStart: (replace: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [deepConfirmed, setDeepConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deep = options.scope === "application-deep";
  useEffect(() => {
    if (!deep) setDeepConfirmed(false);
  }, [deep]);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const blocked = Boolean(disabledReason);

  return (
    <div className="space-y-3">
      <Notice tone="warning">
        {t(
          options.scope === "page"
            ? "domConfig.safetyPage"
            : "domConfig.safety",
        )}
      </Notice>
      {deep && (
        <label className="flex items-start gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={deepConfirmed}
            onChange={(e) => setDeepConfirmed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-info"
          />
          <span>{t("domConfig.options.deepConfirm")}</span>
        </label>
      )}
      {confirming ? (
        <Notice tone="warning">
          <p id={`${id}-replace`}>
            {t("domConfig.replace.message", { count: replaceCount })}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              aria-describedby={`${id}-replace`}
              disabled={blocked}
              onClick={() => {
                setConfirming(false);
                onStart(true);
              }}
            >
              {t("domConfig.replace.confirm")}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t("domConfig.replace.cancel")}
            </Button>
          </div>
        </Notice>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={blocked || (deep && !deepConfirmed)}
          aria-describedby={blocked ? disabledId : undefined}
          onClick={() =>
            replaceCount > 0 ? setConfirming(true) : onStart(false)
          }
        >
          {t(startLabel)}
        </Button>
      )}
    </div>
  );
}
