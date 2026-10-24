import { Button } from "@apty/ui/components/ui/button";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { useId, useState } from "react";
import type { DomConfigScope, DomConfigStartOptions } from "./dom-config-store";

const SCOPES: { value: DomConfigScope; label: TranslationKey }[] = [
  { value: "page", label: "domConfig.options.page" },
  { value: "application-safe", label: "domConfig.options.applicationSafe" },
  { value: "application-deep", label: "domConfig.options.applicationDeep" },
];

const INPUT =
  "w-20 rounded-md border bg-background px-1.5 py-1 text-xs text-foreground";

export function StartPanel({
  options,
  onChange,
  onStart,
  disabledReason,
}: {
  options: DomConfigStartOptions;
  onChange: (options: Partial<DomConfigStartOptions>) => void;
  onStart: () => void;
  /** Why Start is not available; null when it is. */
  disabledReason: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [deepConfirmed, setDeepConfirmed] = useState(false);
  const deep = options.scope === "application-deep";
  const blocked = disabledReason ?? null;

  return (
    <div className="space-y-3 pt-1 text-xs">
      <p className="text-muted-foreground">{t("domConfig.intro")}</p>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 font-medium text-foreground">
          {t("domConfig.options.scope")}
        </legend>
        {SCOPES.map((scope) => (
          <label
            key={scope.value}
            className="flex items-start gap-2 text-foreground"
          >
            <input
              type="radio"
              name={`${id}-scope`}
              value={scope.value}
              checked={options.scope === scope.value}
              onChange={() => {
                onChange({ scope: scope.value });
                setDeepConfirmed(false);
              }}
              className="mt-0.5"
            />
            <span>{t(scope.label)}</span>
          </label>
        ))}
      </fieldset>
      {deep && (
        <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground">
          <input
            type="checkbox"
            checked={deepConfirmed}
            onChange={(e) => setDeepConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>{t("domConfig.options.deepConfirm")}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-foreground">
          <span>{t("domConfig.options.runsPerPage")}</span>
          <select
            value={options.runsPerState}
            onChange={(e) =>
              onChange({
                runsPerState: Number(e.target.value) as 2 | 3 | 4,
              })
            }
            className={INPUT}
          >
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-foreground">
          <input
            type="checkbox"
            checked={options.probe}
            onChange={(e) => onChange({ probe: e.target.checked })}
          />
          <span>{t("domConfig.options.probe")}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-foreground">
          <span>{t("domConfig.options.maxPages")}</span>
          <input
            type="number"
            min={1}
            max={200}
            value={options.scope === "page" ? 1 : options.maxPages}
            disabled={options.scope === "page"}
            onChange={(e) =>
              onChange({ maxPages: Math.max(1, Number(e.target.value) || 1) })
            }
            className={INPUT}
          />
        </label>
        <label className="flex items-center gap-2 text-foreground">
          <span>{t("domConfig.options.maxMinutes")}</span>
          <input
            type="number"
            min={1}
            max={60}
            value={options.maxMinutes}
            onChange={(e) =>
              onChange({
                maxMinutes: Math.max(1, Number(e.target.value) || 1),
              })
            }
            className={INPUT}
          />
        </label>
      </div>
      <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-foreground">
        {t(
          options.scope === "page"
            ? "domConfig.safetyPage"
            : "domConfig.safety",
        )}
      </p>
      <p className="text-muted-foreground">{t("domConfig.memoryOnly")}</p>
      {blocked && (
        <p className="text-foreground" role="note">
          {blocked}
        </p>
      )}
      <Button
        size="sm"
        disabled={Boolean(blocked) || (deep && !deepConfirmed)}
        onClick={onStart}
        aria-label={t("domConfig.startAria")}
      >
        {t("domConfig.start")}
      </Button>
    </div>
  );
}
