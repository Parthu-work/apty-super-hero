import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// Component that throws on render
function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test rendering error");
  }
  return <div>Normal content</div>;
}

describe("ErrorBoundary", () => {
  // Suppress React error boundary console.error during tests
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Hello World")).toBeTruthy();
  });

  it("renders fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows error details in expandable section", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Test rendering error")).toBeTruthy();
  });

  it("shows the error's message only, never its stack, and masks a key it echoes", () => {
    function LeakyComponent(): never {
      const error = new Error(
        "Request failed: Authorization: Bearer sk-live-0123456789abcdef and key sk-ant-api03-abcdefghijklmnop",
      );
      error.stack = `${error.message}\n    at LeakyComponent (/home/dev/src/leaky.tsx:3:9)`;
      throw error;
    }
    render(
      <ErrorBoundary>
        <LeakyComponent />
      </ErrorBoundary>,
    );

    const details = screen.getByText("Details").closest("details");
    expect(details?.querySelector("pre")?.textContent).toBe(
      "Request failed: Authorization: [REDACTED] and key [REDACTED]",
    );
    expect(document.body.textContent).not.toContain("sk-");
    expect(document.body.textContent).not.toContain("leaky.tsx");
  });

  it("resets error state when Try Again is clicked", () => {
    // Use a stateful wrapper so we can control the throw behavior
    let shouldThrow = true;
    function ConditionalThrower() {
      if (shouldThrow) throw new Error("Boom");
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeTruthy();

    // Stop throwing before clicking retry
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Recovered")).toBeTruthy();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Custom error UI")).toBeTruthy();
  });

  it("calls onError callback when an error is caught", () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Test rendering error" }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });
});
