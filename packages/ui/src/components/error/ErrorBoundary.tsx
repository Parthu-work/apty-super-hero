/**
 * ErrorBoundary
 * Catches React rendering errors and displays a recovery UI
 * instead of an unrecoverable white screen.
 */

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import React from "react";
import { useTranslation } from "../../i18n/context";
import { Button } from "../ui/button";

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
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-y-auto bg-background p-6 text-center text-foreground">
      <div
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive-muted"
        aria-hidden="true"
      >
        <AlertTriangleIcon className="size-6 text-destructive" />
      </div>

      <div className="max-w-xs space-y-2">
        <h2 className="text-base font-semibold">{t("errorBoundary.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("errorBoundary.description")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("errorBoundary.hint")}
        </p>
      </div>

      <Button type="button" size="sm" onClick={onRetry}>
        <RotateCcwIcon className="size-4" aria-hidden="true" />
        {t("errorBoundary.retry")}
      </Button>

      {error && (
        <details className="w-full max-w-xs text-left">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("errorBoundary.details")}
          </summary>
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2 text-left text-[11px] leading-relaxed text-muted-foreground">
            {error.stack ?? `${error.name}: ${error.message}`}
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
