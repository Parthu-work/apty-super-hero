/**
 * What Options shows of the organization policy (KB-RAG K22, S2): a banner
 * when the policy cannot be used, and the AI fields it sets as read-only
 * values with no edit control.
 */
import type { AppSettings } from "@apty/agent-core";
import { Building2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "../../i18n/context";
import type { TranslationKey } from "../../i18n/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { OrgPolicyView } from "./types";

/** The AI fields a policy can preset, in the order Options shows them. */
const AI_FIELDS = [
  ["aiProvider", "orgPolicy.provider"],
  ["aiHost", "settings.aiHost"],
  ["aiModel", "settings.aiModel"],
  ["aiToken", "settings.aiToken"],
  ["aiWorkspaceId", "settings.aiWorkspaceId"],
] as const satisfies readonly [keyof AppSettings, TranslationKey][];

type AiField = (typeof AI_FIELDS)[number][0];
type EditableField = Exclude<AiField, "aiProvider">;

/** Whether the policy sets any AI field, so the AI card is shown read-only. */
export function aiFieldsLocked(policy: OrgPolicyView | undefined): boolean {
  return AI_FIELDS.some(([key]) => policy?.locked.has(key));
}

export function OrgPolicyBanner({ policy }: { policy?: OrgPolicyView }) {
  const { t } = useTranslation();
  if (!policy?.invalidReason) return null;
  return (
    <Alert variant="destructive" role="alert" data-testid="org-policy-invalid">
      <TriangleAlert className="h-4 w-4" />
      <AlertDescription>
        {t("orgPolicy.invalid", { reason: policy.invalidReason })}
      </AlertDescription>
    </Alert>
  );
}

/** "Set by your organization" under a locked field. */
function SetByOrganization({ id }: { id?: string }) {
  const { t } = useTranslation();
  return (
    <p
      id={id}
      className="flex items-center gap-1 text-xs text-muted-foreground"
    >
      <Building2 className="h-3 w-3" aria-hidden="true" />
      {t("orgPolicy.setByOrg")}
    </p>
  );
}

function LockedValue({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1" data-testid={`locked-${id}`}>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="space-y-1">
        <p className="rounded-md border bg-muted px-3 py-2 text-sm break-all">
          {value}
        </p>
        <SetByOrganization id={`${id}-note`} />
      </dd>
    </div>
  );
}

/**
 * The AI provider card when the policy presets any AI field: those fields
 * read-only, the rest editable and saved with `onSave`.
 */
export function LockedAiCard({
  policy,
  onSave,
}: {
  policy: OrgPolicyView;
  onSave: (changes: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const [edits, setEdits] = useState<Partial<Record<EditableField, string>>>(
    {},
  );
  const [saved, setSaved] = useState(false);

  const currentValue = (key: AiField) => policy.settings[key] ?? "";
  const shown = (key: AiField) => {
    const value = currentValue(key);
    if (!value) return t("orgPolicy.notSet");
    return key === "aiToken" ? t("orgPolicy.tokenSet") : value;
  };
  // The provider is chosen in the full AI card; here it is only shown.
  const editable = AI_FIELDS.flatMap(([key, label]) =>
    key === "aiProvider" || policy.locked.has(key)
      ? []
      : [{ key: key as EditableField, label }],
  );

  return (
    <Card id="ai-provider" data-testid="org-policy-ai-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" aria-hidden="true" />
          {t("orgPolicy.aiTitle")}
        </CardTitle>
        <CardDescription>{t("orgPolicy.aiDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-4">
          {AI_FIELDS.filter(([key]) => policy.locked.has(key)).map(
            ([key, label]) => (
              <LockedValue
                key={key}
                id={`${baseId}-${key}`}
                label={t(label)}
                value={shown(key)}
              />
            ),
          )}
        </dl>
        {editable.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`${baseId}-${key}-input`}>{t(label)}</Label>
            <Input
              id={`${baseId}-${key}-input`}
              type={key === "aiToken" ? "password" : "text"}
              value={edits[key] ?? currentValue(key)}
              onChange={(e) => {
                setSaved(false);
                setEdits((prev) => ({ ...prev, [key]: e.target.value }));
              }}
            />
          </div>
        ))}
        {editable.length > 0 && (
          <div className="flex items-center gap-3">
            <Button
              onClick={async () => {
                await onSave(edits);
                setSaved(true);
              }}
            >
              {t("orgPolicy.save")}
            </Button>
            {saved && (
              <span role="status" className="text-sm text-muted-foreground">
                {t("orgPolicy.saved")}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
