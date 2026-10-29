import {
  type AppSettings,
  MAX_OUTPUT_TOKENS_RANGE,
  REQUEST_TOKEN_BUDGET_RANGE,
} from "@apty/agent-core";
import { Gauge } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface RequestLimitsCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

interface LimitFieldProps {
  id: string;
  label: string;
  hint: string;
  value: number | undefined;
  range: { min: number; max: number };
  onCommit: (value: number | undefined) => void;
}

const formatted = (n: number) => n.toLocaleString("en-US");

function LimitField({
  id,
  label,
  hint,
  value,
  range,
  onCommit,
}: LimitFieldProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value?.toString() ?? "");
  useEffect(() => setText(value?.toString() ?? ""), [value]);

  const cleaned = text.replace(/[,\s_]/g, "");
  const parsed = cleaned === "" ? undefined : Number(cleaned);
  const invalid =
    parsed !== undefined &&
    !(Number.isInteger(parsed) && parsed >= range.min && parsed <= range.max);
  const commit = () => {
    if (!invalid && parsed !== value) onCommit(parsed);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        placeholder={t("settings.requestLimits.unset")}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        className="font-mono"
      />
      <p
        id={`${id}-hint`}
        className={cn(
          "text-xs",
          invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {invalid
          ? t("settings.requestLimits.outOfRange", {
              min: formatted(range.min),
              max: formatted(range.max),
            })
          : hint}
      </p>
    </div>
  );
}

/** The request budget and the answer cap; each saves when the field is left or Enter is pressed. */
export function RequestLimitsCard({
  settings,
  onChange,
}: RequestLimitsCardProps) {
  const { t } = useTranslation();
  return (
    <Card id="request-limits" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge aria-hidden="true" className="h-5 w-5" />
          {t("settings.requestLimits.title")}
        </CardTitle>
        <CardDescription>
          {t("settings.requestLimits.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <LimitField
          id="request-token-budget"
          label={t("settings.requestLimits.budgetLabel")}
          hint={t("settings.requestLimits.budgetHint")}
          value={settings.requestTokenBudget}
          range={REQUEST_TOKEN_BUDGET_RANGE}
          onCommit={(requestTokenBudget) => onChange({ requestTokenBudget })}
        />
        <LimitField
          id="max-output-tokens"
          label={t("settings.requestLimits.outputLabel")}
          hint={t("settings.requestLimits.outputHint")}
          value={settings.maxOutputTokens}
          range={MAX_OUTPUT_TOKENS_RANGE}
          onCommit={(maxOutputTokens) => onChange({ maxOutputTokens })}
        />
      </CardContent>
    </Card>
  );
}
