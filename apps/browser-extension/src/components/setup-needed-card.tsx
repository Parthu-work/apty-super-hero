/**
 * Replaces the old first-run dead end: two stacked messages (a raw
 * "Authentication Required... login" text bubble the product has no login
 * to satisfy, plus a separate "AI Provider Not Configured" card) saved
 * permanently into the conversation. This is a single, non-persisted setup
 * surface: nothing was actually sent, so nothing is added to chat history.
 */

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@apty/ui/components/ui/alert";
import { Button } from "@apty/ui/components/ui/button";
import { SettingsIcon, XIcon } from "lucide-react";

export interface SetupNeededCardProps {
  /** The message the user typed before the send was blocked. */
  draftText: string;
  onOpenSettings: () => void;
  onDismiss: () => void;
}

export function SetupNeededCard({
  draftText,
  onOpenSettings,
  onDismiss,
}: SetupNeededCardProps) {
  const trimmed = draftText.trim();
  const preview = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;

  return (
    <Alert variant="warning" className="relative mb-4">
      <SettingsIcon aria-hidden="true" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 h-6 w-6"
      >
        <XIcon className="h-4 w-4" />
      </Button>
      <AlertTitle>Connect an AI provider</AlertTitle>
      <AlertDescription>
        <p className="mb-2">
          This product is BYOK-only: there is no login, so add your own API key
          in Settings before sending a message.
        </p>
        {preview && (
          <p className="mb-3 rounded border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
            Your message wasn't sent: &ldquo;{preview}&rdquo;
          </p>
        )}
        <Button type="button" size="sm" onClick={onOpenSettings}>
          <SettingsIcon aria-hidden="true" />
          Open Settings
        </Button>
      </AlertDescription>
    </Alert>
  );
}
