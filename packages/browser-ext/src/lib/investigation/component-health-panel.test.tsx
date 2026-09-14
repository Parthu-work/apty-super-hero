import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComponentHealthPanel } from "./component-health-panel";

describe("ComponentHealthPanel", () => {
  it("renders every component with its real state and detail, never fabricating a status", () => {
    render(
      <ComponentHealthPanel
        components={[
          {
            kind: "apty-client",
            label: "Client",
            state: "healthy",
            detail: "Initialized",
          },
          {
            kind: "apty-widget",
            label: "Widget",
            state: "warning",
            detail: "Not yet initialized",
          },
          {
            kind: "apty-studio",
            label: "Studio",
            state: "not_configured",
            detail: "Requires Apty-side integration",
          },
          {
            kind: "service-worker",
            label: "Service Worker",
            state: "not_checked",
            detail: "Not checked yet in this conversation",
          },
        ]}
      />,
    );

    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("Initialized")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Not yet initialized")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
  });
});
