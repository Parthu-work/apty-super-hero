import type { ScreenshotPolicySetting } from "@apty/agent-core";
import { useTranslation } from "../../i18n/context";
import type { TranslationKey } from "../../i18n/types";

const OPTIONS: Array<{
  value: ScreenshotPolicySetting;
  label: TranslationKey;
  hint: TranslationKey;
}> = [
  {
    value: "ask",
    label: "settings.screenshotPolicyAsk",
    hint: "settings.screenshotPolicyAskHint",
  },
  {
    value: "allow",
    label: "settings.screenshotPolicyAllow",
    hint: "settings.screenshotPolicyAllowHint",
  },
  {
    value: "never",
    label: "settings.screenshotPolicyNever",
    hint: "settings.screenshotPolicyNeverHint",
  },
];

export interface ScreenshotPolicyControlProps {
  policy: ScreenshotPolicySetting;
  onChange: (policy: ScreenshotPolicySetting) => void;
}

export function ScreenshotPolicyControl({
  policy,
  onChange,
}: ScreenshotPolicyControlProps) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {t("settings.screenshotPolicy")}
      </legend>
      <p className="text-xs text-muted-foreground">
        {t("settings.screenshotPolicyHint")}
      </p>
      {OPTIONS.map((option) => {
        const id = `screenshot-policy-${option.value}`;
        return (
          <div key={option.value} className="rounded-md border p-2">
            <div className="flex items-start gap-2">
              <input
                type="radio"
                id={id}
                name="screenshot-policy"
                value={option.value}
                checked={policy === option.value}
                onChange={() => onChange(option.value)}
                aria-describedby={`${id}-description`}
                className="mt-1"
              />
              <div className="flex-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {t(option.label)}
                </label>
                <p
                  id={`${id}-description`}
                  className="text-xs text-muted-foreground"
                >
                  {t(option.hint)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
