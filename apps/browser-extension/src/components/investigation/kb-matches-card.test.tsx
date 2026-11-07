import type { UIToolPart } from "@apty/ui/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AptyToolDisplay } from "./apty-tool-display";

function tool(output: unknown): UIToolPart {
  return {
    type: "tool",
    toolName: "search_kb",
    toolCallId: "call-1",
    input: { query: "the tooltip opens twice", topK: 3 },
    output,
    state: "completed",
  };
}

const hit = (
  pageId: string,
  layer: number,
  text: string,
  notVerified = false,
) => ({
  cite: `kb://${pageId}#L${layer}`,
  title: `FIXTURE card ${pageId}`,
  layer,
  heading: `Layer ${layer}: FIXTURE`,
  verifiedOn: "Verified on: FIXTURE code, 2026-01-01.",
  notVerified,
  score: 2,
  text,
});

describe("KbMatchesCard", () => {
  it("lists each card with its link, layer, text, Verified on line and Not verified badge", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          results: [
            hit(
              "202",
              1,
              "- In Studio, clear the FIXTURE Double Trigger setting.",
            ),
            hit("101", 3, "- NOT VERIFIED: FIXTURE glow.json.", true),
          ],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const first = within(items[0] as HTMLElement);
    expect(
      first.getByRole("link", { name: /FIXTURE card 202/ }),
    ).toHaveAttribute(
      "href",
      "https://apty.atlassian.net/wiki/spaces/JA/pages/202",
    );
    expect(first.getByText("Layer 1 of the card")).toBeInTheDocument();
    expect(
      first.getByText("- In Studio, clear the FIXTURE Double Trigger setting."),
    ).toBeInTheDocument();
    expect(first.queryByText("Not verified")).toBeNull();
    expect(
      within(items[1] as HTMLElement).getByText("Not verified"),
    ).toBeInTheDocument();
  });

  it("shortens a long layer on a word boundary", () => {
    const long = `- ${"FIXTURE word ".repeat(40)}`;
    render(
      <AptyToolDisplay
        tool={tool({ status: "ok", results: [hit("5", 2, long)] })}
      />,
    );
    const text = screen.getByText(/^- FIXTURE word/).textContent ?? "";
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(281);
  });

  it("keeps the default display for not covered, no pack, or anything malformed", () => {
    for (const output of [
      { status: "not_covered", results: [] },
      { status: "no_pack", results: [] },
      {
        status: "ok",
        results: [{ ...hit("1", 1, "x"), cite: "https://x.test" }],
      },
    ]) {
      const { unmount } = render(<AptyToolDisplay tool={tool(output)} />);
      expect(
        screen.queryByRole("region", { name: "KB cards that match" }),
      ).toBeNull();
      unmount();
    }
  });
});
