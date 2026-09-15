/**
 * ErrorBoundary
 * Catches React rendering errors and displays a recovery UI
 * instead of an unrecoverable white screen.
 */

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import React from "react";
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
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-y-auto bg-background p-6 text-center text-foreground">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-destructive/10"
            aria-hidden="true"
          >
            <AlertTriangleIcon className="size-6 text-destructive" />
          </div>

          <div className="max-w-xs space-y-2">
            <h2 className="text-base font-semibold">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">
              This screen couldn&apos;t be displayed because of an unexpected
              error. It may have been caused by a temporary glitch, a recent
              update, or an unusual page state.
            </p>
            <p className="text-sm text-muted-foreground">
              Try again below, or close and reopen the panel if the problem
              keeps happening.
            </p>
          </div>

          <Button type="button" size="sm" onClick={this.handleRetry}>
            <RotateCcwIcon className="size-4" aria-hidden="true" />
            Try Again
          </Button>

          {this.state.error && (
            <details className="w-full max-w-xs text-left">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                View technical details
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2 text-left text-[11px] leading-relaxed text-muted-foreground">
                {this.state.error.stack ??
                  `${this.state.error.name}: ${this.state.error.message}`}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
