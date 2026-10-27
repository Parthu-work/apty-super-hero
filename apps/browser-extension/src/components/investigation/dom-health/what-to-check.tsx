import type { ApplicationDiscoveryMode } from "@apty/browser-runtime";
import {
  OptionCard,
  OptionCardGroup,
} from "@apty/ui/components/ui/option-card";
import { useTranslation } from "@apty/ui/i18n/context";
import { useId } from "react";
import { type DomHealthStore, useDomHealthState } from "../dom-health-store";
import {
  DISCOVERY_MODE_DESCRIPTION,
  DISCOVERY_MODE_LABEL,
} from "./dom-health-labels";

const MODES: ApplicationDiscoveryMode[] = [
  "application-safe",
  "application-deep",
  "page",
];

/** What the next check covers: this page or the whole application, and how links are discovered. */
export function WhatToCheck({
  store,
  disabled,
}: {
  store: DomHealthStore;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { scope, discoveryMode } = useDomHealthState(store);
  const id = useId();
  return (
    <div className="space-y-4">
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">
          {t("domHealth.page.whatToCheck")}
        </legend>
        <OptionCardGroup>
          <OptionCard
            name={`${id}-scope`}
            value="page"
            checked={scope === "page"}
            onChange={() => store.setScope("page")}
            title={t("domHealth.page.thisPage")}
            description={t("domHealth.page.thisPageBody")}
          />
          <OptionCard
            name={`${id}-scope`}
            value="application"
            checked={scope === "application"}
            onChange={() => store.setScope("application")}
            title={t("domHealth.page.wholeApp")}
            description={t("domHealth.page.wholeAppBody")}
          />
        </OptionCardGroup>
      </fieldset>
      <div className="space-y-1.5">
        <label
          htmlFor={`${id}-discovery`}
          className="block text-sm font-medium text-foreground"
        >
          {t("domHealth.page.linkDiscovery")}
        </label>
        <select
          id={`${id}-discovery`}
          value={discoveryMode}
          disabled={disabled || scope === "page"}
          aria-describedby={`${id}-discovery-help`}
          onChange={(event) =>
            store.setDiscoveryMode(
              event.target.value as ApplicationDiscoveryMode,
            )
          }
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(DISCOVERY_MODE_LABEL[mode])}
            </option>
          ))}
        </select>
        <p
          id={`${id}-discovery-help`}
          className="text-small text-muted-foreground"
        >
          {t("domHealth.page.linkDiscoveryHelp")}{" "}
          {t(DISCOVERY_MODE_DESCRIPTION[discoveryMode])}
        </p>
      </div>
    </div>
  );
}
