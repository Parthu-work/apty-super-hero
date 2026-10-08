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
import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function minutesLeft(grant: ApprovalGrant): number {
  return Math.max(1, Math.ceil((grant.expiresAt - Date.now()) / 60_000));
}

/** Lists the "allow on this site" approvals that are still active, with revoke controls. */
export function ApprovalGrantsPanel() {
  const [grants, setGrants] = useState<ApprovalGrant[]>([]);

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
          Remembered approvals
        </CardTitle>
        <CardDescription>
          Risky actions you allowed on a site for a limited time. Revoke one to
          be asked again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active approvals.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {grants.map((grant) => (
                <li
                  key={`${grant.toolName}@${grant.origin}`}
                  className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 break-all">
                    <span className="font-medium">{grant.toolName}</span> on{" "}
                    {grant.origin}
                    <span className="text-muted-foreground">
                      {" "}
                      · {minutesLeft(grant)} min left
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await revokeApprovalGrant(grant.toolName, grant.origin);
                      await refresh();
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                await revokeAllApprovalGrants();
                await refresh();
              }}
            >
              Revoke all
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
