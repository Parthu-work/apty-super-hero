/**
 * A verdict or KB card from another site than the current tab's (KB-RAG
 * K27, F4): collapsed, with "From <site>" as its summary, so evidence from
 * one customer is not read as the current one's.
 */
import { otherSite } from "@apty/agent-core";
import { useTranslation } from "@apty/ui/i18n/context";
import type { ReactNode } from "react";
import { useActiveSiteHost } from "../investigation/kb-version-control";
import { useSiteLabels } from "./use-site-label";

export function OtherSiteFold({
  siteKey,
  children,
}: {
  siteKey: string | undefined;
  children: ReactNode;
}) {
  const host = useActiveSiteHost();
  const { t } = useTranslation();
  const { label } = useSiteLabels();
  if (!otherSite(host, siteKey)) return <>{children}</>;
  return (
    <details className="text-small" data-testid="other-site-fold">
      <summary className="w-fit cursor-pointer rounded-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {t("cases.fromSite", {
          site: label(siteKey) ?? t("cases.otherSiteNote"),
        })}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
