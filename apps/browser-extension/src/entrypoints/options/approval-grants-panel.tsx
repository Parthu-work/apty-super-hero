import {
  type ApprovalGrant,
  listApprovalGrants,
  revokeAllApprovalGrants,
  revokeApprovalGrant,
} from "@apty/browser-runtime/tools/approval";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { ConfirmDialog } from "@apty/ui/components/ui/confirm-dialog";
import { useTranslation } from "@apty/ui/i18n/context";
import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function minutesLeft(grant: ApprovalGrant): number {
  return Math.max(1, Math.ceil((grant.expiresAt - Date.now()) / 60_000));
}

/** Lists the "allow on this site" approvals that are still active, with revoke controls. */
export function ApprovalGrantsPanel() {
  const { t } = useTranslation();
  const [grants, setGrants] = useState<ApprovalGrant[]>([]);
  const [confirmingRevokeAll, setConfirmingRevokeAll] = useState(false);

  const refresh = useCallback(async () => {
    setGrants(await listApprovalGrants());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card id="approvals" className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {t("approvalGrants.title")}
        </CardTitle>
        <CardDescription>{t("approvalGrants.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("approvalGrants.none")}
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {grants.map((grant) => (
                <li
                  key={`${grant.toolName}@${grant.origin}@${grant.requester}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 break-all">
                    <span className="font-mono font-medium">
                      {grant.toolName}
                    </span>{" "}
                    {t("approvalGrants.onOrigin", {
                      origin: grant.origin,
                      requester: t(
                        grant.requester === "mcp"
                          ? "approvalGrants.mcpClients"
                          : "approvalGrants.chat",
                      ),
                    })}
                    <span className="text-muted-foreground">
                      {` · ${t("approvalGrants.minutesLeft", {
                        count: minutesLeft(grant),
                      })}`}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await revokeApprovalGrant(
                        grant.toolName,
                        grant.origin,
                        grant.requester,
                      );
                      await refresh();
                    }}
                  >
                    {t("approvalGrants.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="danger"
              onClick={() => setConfirmingRevokeAll(true)}
            >
              {t("approvalGrants.revokeAll")}
            </Button>
            <ConfirmDialog
              open={confirmingRevokeAll}
              onOpenChange={setConfirmingRevokeAll}
              title={t("approvalGrants.revokeAllTitle")}
              description={t("approvalGrants.revokeAllDescription")}
              confirmLabel={t("approvalGrants.revokeAll")}
              onConfirm={() => {
                setConfirmingRevokeAll(false);
                void revokeAllApprovalGrants().then(refresh);
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
