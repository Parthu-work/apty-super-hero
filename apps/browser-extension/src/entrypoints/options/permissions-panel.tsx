/**
 * Toggles for the optional permissions (M5): bookmarks, history, management.
 * Declared as `optional_permissions` in manifest.json (not granted at
 * install time) — each toggle here is the only way to grant or revoke one,
 * via `chrome.permissions.request`/`.remove` from this button's own click
 * (a real user gesture, required by Chrome for `.request`).
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { Switch } from "@apty/ui/components/ui/switch";
import { useTranslation } from "@apty/ui/i18n/context";
import type { TranslationKey } from "@apty/ui/i18n/types";
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  hasOptionalPermission,
  OPTIONAL_PERMISSIONS,
  type OptionalPermissionName,
  removeOptionalPermission,
  requestOptionalPermission,
} from "../../services/optional-permissions";

const PERMISSION_COPY: Record<
  OptionalPermissionName,
  { label: TranslationKey; description: TranslationKey }
> = {
  bookmarks: {
    label: "permissions.bookmarks",
    description: "permissions.bookmarksDescription",
  },
  history: {
    label: "permissions.history",
    description: "permissions.historyDescription",
  },
  management: {
    label: "permissions.management",
    description: "permissions.managementDescription",
  },
};

export function PermissionsPanel() {
  const { t } = useTranslation();
  const [granted, setGranted] = useState<
    Record<OptionalPermissionName, boolean>
  >({ bookmarks: false, history: false, management: false });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const entries = await Promise.all(
        OPTIONAL_PERMISSIONS.map(
          async (name) => [name, await hasOptionalPermission(name)] as const,
        ),
      );
      setGranted(Object.fromEntries(entries) as Record<string, boolean>);
      setLoaded(true);
    })();
  }, []);

  const handleToggle = async (
    name: OptionalPermissionName,
    checked: boolean,
  ) => {
    const result = checked
      ? await requestOptionalPermission(name)
      : await removeOptionalPermission(name);
    // `request` resolves false (not rejected) if the user declines the
    // browser's own permission prompt — reflect the real resulting state
    // either way, never assume the toggle's new position is correct.
    const actual = checked ? result : !result;
    setGranted((prev) => ({ ...prev, [name]: actual }));
  };

  return (
    <Card id="permissions" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {t("permissions.title")}
        </CardTitle>
        <CardDescription>{t("permissions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {OPTIONAL_PERMISSIONS.map((name) => (
          <div key={name} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {t(PERMISSION_COPY[name].label)}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(PERMISSION_COPY[name].description)}
              </p>
            </div>
            <Switch
              aria-label={t(PERMISSION_COPY[name].label)}
              checked={granted[name]}
              disabled={!loaded}
              onCheckedChange={(checked) => handleToggle(name, checked)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
