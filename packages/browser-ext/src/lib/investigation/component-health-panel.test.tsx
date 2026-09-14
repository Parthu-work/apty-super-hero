import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComponentHealthPanel } from "./component-health-panel";

describe("ComponentHealthPanel", () => {
  it("renders exactly two grouped components with their real state and detail, never fabricating a status", () => {
    render(
      <ComponentHealthPanel
        components={[
          {
            kind: "apty-client-widget-player",
            label: "Apty Client / Widget / Player",
            state: "warning",
            detail: "Widget: Not yet initialized",
            subComponents: [
              {
                key: "apty-client",
                label: "Client",
                state: "healthy",
                detail: "Initialized",
              },
              {
                key: "apty-widget",
                label: "Widget",
                state: "warning",
                detail: "Not yet initialized",
              },
              {
                key: "service-worker",
                label: "Service Worker",
                state: "not_checked",
                detail: "Not checked yet in this conversation",
              },
            ],
          },
          {
            kind: "apty-studio",
            label: "Apty Studio",
            state: "not_configured",
            detail: "Requires Apty-side integration",
            subComponents: [
              {
                key: "apty-studio",
                label: "Studio",
                state: "not_configured",
                detail: "Requires Apty-side integration",
              },
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getByText("Apty Client / Widget / Player"),
    ).toBeInTheDocument();
    expect(screen.getByText("Apty Studio")).toBeInTheDocument();
    expect(screen.getByText("Widget: Not yet initialized")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();

    // Sub-component drill-down is real per-probe detail, revealed on expand
    // (never fabricated — it's the same data the aggregated row summarizes).
    fireEvent.click(
      screen.getByRole("button", { name: /Apty Client \/ Widget \/ Player/ }),
    );
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("Service Worker")).toBeInTheDocument();
    expect(
      screen.getByText("Not checked yet in this conversation"),
    ).toBeInTheDocument();
  });
});
