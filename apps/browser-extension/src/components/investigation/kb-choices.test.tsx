import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime/kb/kb-index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sharedKbIndexSource: () => ({
    current: async () => ({
      card: (pageId: string) => ({
        pageId,
        title: `FIXTURE card ${pageId}`,
        url: `https://fixture.atlassian.net/wiki/spaces/FX/pages/${pageId}`,
      }),
      cardChunks: (pageId: string) =>
        [1, 2, 3, 4].map((layer) => ({
          id: `${pageId}#L${layer}`,
          pageId,
          layer,
          heading: "",
          text: `FIXTURE ${pageId} layer ${layer}`,
          notVerified: false,
        })),
    }),
  }),
}));

import { AptyToolDisplay } from "./apty-tool-display";

const tool = (output: unknown): UIToolPart => ({
  type: "tool",
  toolName: "search_kb",
  toolCallId: "call-1",
  input: { query: "FIXTURE flow not working", topK: 3 },
  output,
  state: "completed",
});

const hit = (pageId: string) => ({
  cite: `kb://${pageId}#L1`,
  title: `FIXTURE card ${pageId}`,
  site: "fixture.atlassian.net",
  space: "FX",
  aptyVersion: "4.x",
  layer: 1,
  heading: "",
  verifiedOn: null,
  notVerified: false,
  score: 1,
  text: "FIXTURE",
});

describe("choices on a broad symptom (KB-RAG K27, E3)", () => {
  it("asks which one instead of showing cards, and choosing one shows that card", async () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          source: "kb",
          cards: [{ pageId: "801" }],
          results: [hit("801"), hit("802")],
          choices: {
            cite: "kb://800",
            title: "Start here, FIXTURE flows",
            options: [
              { cite: "kb://801", title: "FIXTURE flow halts" },
              { cite: "kb://802", title: "FIXTURE flow never launches" },
            ],
          },
        })}
      />,
    );
    const choices = screen.getByTestId("kb-choices");
    expect(
      within(choices).getByText("Which of these is it?"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
    fireEvent.click(
      within(choices).getByRole("button", {
        name: "FIXTURE flow never launches",
      }),
    );
    const chosen = await screen.findByTestId("kb-chosen-card");
    expect(
      within(chosen).getByRole("link", { name: /FIXTURE card 802/ }),
    ).toBeInTheDocument();
    expect(within(chosen).getByText("FIXTURE 802 layer 1")).toBeInTheDocument();
  });
});
