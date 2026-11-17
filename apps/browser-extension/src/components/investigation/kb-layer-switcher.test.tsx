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
    expect(screen.getByRole("button", { name: "L2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const layer of [1, 3, 4]) {
      fireEvent.click(screen.getByRole("button", { name: `L${layer}` }));
      expect(
        await screen.findByText(`FIXTURE layer ${layer} text`),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "L3" }));
    expect(await screen.findByText("Not verified")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Card layers" }),
    ).toBeInTheDocument();
  });
});
