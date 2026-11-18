import { fireEvent, render, screen } from "@testing-library/react";
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

describe("KbLayerSwitcher (KB-RAG K27, F6)", () => {
  it("starts on the shown layer and reaches every layer by its button", async () => {
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
    expect(
      screen.getByRole("button", { name: "Layer 2, Console and Elements" }),
    ).toHaveAttribute("aria-pressed", "true");
    for (const layer of [1, 3, 4]) {
      fireEvent.click(
        screen.getByRole("button", { name: new RegExp(`^Layer ${layer},`) }),
      );
      expect(
        await screen.findByText(`FIXTURE layer ${layer} text`),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /^Layer 3,/ }));
    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Card layers" }),
    ).toBeInTheDocument();
  });
});

describe("walking a card's layers (KB-RAG K27, E2)", () => {
  it("names each layer and steps with Next from settings to contact support, then stops", async () => {
    render(
      <KbLayerSwitcher
        pageId="701"
        layer={1}
        text="FIXTURE shown text"
        notVerified={false}
      />,
    );
    expect(screen.getByTestId("kb-layer-name")).toHaveTextContent(
      "Layer 1: Settings",
    );
    for (const [layer, name] of [
      [2, "Console and Elements"],
      [3, "Network data"],
      [4, "Contact support"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: `Next: ${name}` }));
      expect(screen.getByTestId("kb-layer-name")).toHaveTextContent(
        `Layer ${layer}: ${name}`,
      );
      expect(
        await screen.findByText(`FIXTURE layer ${layer} text`),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
  });
});
