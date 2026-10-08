import { DEFAULT_RETENTION_MS } from "@apty/agent-core";
import { conversationStorage } from "@apty/browser-runtime/conversation/conversation-storage";
import { RuntimeScreenshotStorage } from "@apty/browser-runtime/storage/screenshot-storage";
import { Button } from "@apty/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@apty/ui/components/ui/card";
import { Trash2 } from "lucide-react";
import { useState } from "react";

const RETENTION_DAYS = Math.round(DEFAULT_RETENTION_MS / (24 * 60 * 60 * 1000));

type PurgeState = "idle" | "confirming" | "deleting" | "done" | "failed";

/** States the retention policy and deletes every stored conversation and screenshot on request. */
export function StoredDataPanel() {
  const [state, setState] = useState<PurgeState>("idle");

  const purge = async () => {
    setState("deleting");
    try {
      await Promise.all([
        conversationStorage.clearAllConversations(),
        RuntimeScreenshotStorage.clearAll(),
      ]);
      setState("done");
    } catch {
      setState("failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Stored conversations and screenshots
        </CardTitle>
        <CardDescription>
          Kept only on this device, and deleted automatically after{" "}
          {RETENTION_DAYS} days without use (at most 5 conversations and 50
          screenshots).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state === "confirming" ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Delete every stored conversation and screenshot?
            </span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={purge}
            >
              Delete everything
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setState("idle")}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={state === "deleting"}
            onClick={() => setState("confirming")}
          >
            Delete stored data now
          </Button>
        )}
        {state === "done" && (
          <p className="text-sm text-muted-foreground">
            All stored conversations and screenshots were deleted.
          </p>
        )}
        {state === "failed" && (
          <p className="text-sm text-destructive">
            Deleting stored data failed. Try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
