import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../services/kb-cards", () => ({
  useKbCatalog: () => ({
    cards: [
      {
        pageId: "101",
        title: "FIXTURE banner never glows",
        aptyVersion: "5.x",
        url: "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/101",
      },
      {
        pageId: "202",
        title: "FIXTURE tooltip opens twice",
        aptyVersion: "5.x",
        url: "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/202",
      },
    ],
    text: () => undefined,
  }),
}));

import { KbClosestSuggestions } from "./kb-closest-suggestions";

describe("KbClosestSuggestions (KB-RAG K27, E7)", () => {
  it("lists the closest cards in the record's order, linked, under a may-not-match heading", () => {
    render(<KbClosestSuggestions pageIds={["202", "999", "101"]} />);
    const region = screen.getByRole("region", {
      name: "Closest KB cards, may not match",
    });
    expect(region).toBeInTheDocument();
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/202",
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/101",
    ]);
  });

  it("shows nothing when no id is a loaded card", () => {
    const { container } = render(<KbClosestSuggestions pageIds={["999"]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
