import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime/kb/kb-index", () => ({
  sharedKbIndexSource: () => ({
    current: async () => ({
      cardChunks: () =>
        [1, 2, 3, 4].map((layer) => ({
          id: `701#L${layer}`,
          pageId: "701",
          layer,
          heading: `Layer ${layer}: FIXTURE`,
          text: `FIXTURE layer ${layer} text`,
          notVerified: layer === 3,
        })),
    }),
  }),
}));

import { KbLayerSwitcher } from "./kb-layer-switcher";

describe("KbLayerSwitcher (KB-RAG K27, F6; K29, D1)", () => {
  it("names the layers Settings, Console, Network and Support, keeps L1 to L4 as descriptions, and reaches every layer", async () => {
    render(
      <KbLayerSwitcher
        pageId="701"
        layer={2}
        text="FIXTURE shown text"
        notVerified={false}
      />,
    );
    expect(screen.getByTestId("kb-layer-text")).toHaveTextContent(
      "FIXTURE shown text",
    );
    const tabs = within(
      screen.getByRole("tablist", { name: "Card layers" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Settings",
      "Console",
      "Network",
      "Support",
    ]);
    expect(screen.getByRole("tab", { name: "Console" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: "Settings" }),
    ).toHaveAccessibleDescription("L1, Settings");
    expect(
      screen.getByRole("tab", { name: "Network" }),
    ).toHaveAccessibleDescription("L3, Network data");
    for (const [layer, name] of [
      [1, "Settings"],
      [3, "Network"],
      [4, "Support"],
    ] as const) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(
        await screen.findByText(`FIXTURE layer ${layer} text`),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Network" }));
    expect(await screen.findByText("Not verified")).toBeInTheDocument();
  });

  it("moves between layers with the arrow keys, one tab stop for the group", async () => {
    render(
      <KbLayerSwitcher
        pageId="701"
        layer={1}
        text="FIXTURE shown text"
        notVerified={false}
      />,
    );
    const settings = screen.getByRole("tab", { name: "Settings" });
    expect(
      screen.getAllByRole("tab").filter((tab) => tab.tabIndex === 0),
    ).toEqual([settings]);
    settings.focus();
    fireEvent.keyDown(settings, { key: "ArrowRight" });
    const console = screen.getByRole("tab", { name: "Console" });
    expect(console).toHaveFocus();
    expect(console).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(console, { key: "End" });
    expect(screen.getByRole("tab", { name: "Support" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Support" }), {
      key: "ArrowRight",
    });
    expect(settings).toHaveFocus();
    expect(await screen.findByText("FIXTURE shown text")).toBeInTheDocument();
  });

  it("reads a layer as numbered steps, shows Not verified once and marks the statement", () => {
    render(
      <KbLayerSwitcher
        pageId="701"
        layer={1}
        text={
          "- In Studio, open FIXTURE Glow.\n- NOT VERIFIED: FIXTURE pulse resets.\n- Publish."
        }
        notVerified
      />,
    );
    const steps = within(screen.getByTestId("kb-layer-text")).getAllByRole(
      "listitem",
    );
    expect(steps.map((step) => step.textContent)).toEqual([
      "In Studio, open FIXTURE Glow.",
      "NOT VERIFIED: FIXTURE pulse resets.",
      "Publish.",
    ]);
    expect(screen.getAllByText("Not verified")).toHaveLength(1);
    expect(
      within(steps[1] as HTMLElement).getByRole("img", {
        name: "Not verified statement",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("kb-step-not-verified")).toHaveLength(1);
  });
});

describe("walking a card's layers (KB-RAG K27, E2)", () => {
  it("steps with Next from settings to support, then stops", async () => {
    render(
      <KbLayerSwitcher
        pageId="701"
        layer={1}
        text="FIXTURE shown text"
        notVerified={false}
      />,
    );
    for (const [layer, name] of [
      [2, "Console"],
      [3, "Network"],
      [4, "Support"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: `Next: ${name}` }));
      expect(screen.getByRole("tab", { name })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        await screen.findByText(`FIXTURE layer ${layer} text`),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
  });
});
