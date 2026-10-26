/**
 * ErrorBoundary
 * Catches React rendering errors and displays a recovery UI
 * instead of an unrecoverable white screen.
 */

import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import React from "react";
import { useTranslation } from "../../i18n/context";
import { maskSecrets } from "../../lib/chat-error";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback UI to render when an error is caught. */
  fallback?: React.ReactNode;
  /** Optional callback invoked when an error is caught. */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const message = error ? maskSecrets(error.message).trim() : "";
  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-background p-4 text-foreground">
      <EmptyState
        role="alert"
        icon={<CircleAlertIcon className="text-destructive" />}
        title={t("errorBoundary.title")}
        description={
          <>
            {t("errorBoundary.description")} {t("errorBoundary.hint")}
          </>
        }
        action={
          <Button type="button" onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {t("errorBoundary.retry")}
          </Button>
        }
      />
      {message && (
        <details className="w-full max-w-80 text-left">
          <summary className="cursor-pointer rounded-sm text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t("errorBoundary.details")}
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs leading-4 text-muted-foreground">
            {message}
          </pre>
        </details>
      )}
    </div>
  );
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error without exposing sensitive data
    console.error("[ErrorBoundary] Uncaught rendering error:", error.message);

    this.props.onError?.(error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback error={this.state.error} onRetry={this.handleRetry} />
      );
    }

    return this.props.children;
  }
}
