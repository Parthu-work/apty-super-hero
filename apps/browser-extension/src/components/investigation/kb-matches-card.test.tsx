import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const localKbMatches = vi.hoisted(() => vi.fn());
vi.mock("@apty/browser-runtime/kb/kb-matches", () => ({
  localKbMatches,
  kbAnswerOf: (outcome: { kind: string; result?: unknown }) =>
    outcome.kind === "answer" ? outcome.result : undefined,
}));

import { forgetKbVersions } from "@apty/browser-runtime/kb/kb-version";
import { AptyToolDisplay } from "./apty-tool-display";

beforeEach(() => {
  localKbMatches.mockReset();
  forgetKbVersions();
});

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
  aptyVersion = "5.x",
) => ({
  cite: `kb://${pageId}#L${layer}`,
  title: `FIXTURE card ${pageId}`,
  site: "fixture.atlassian.net",
  space: aptyVersion === "4.x" ? "A4X" : "JX",
  aptyVersion,
  layer,
  heading: `Layer ${layer}: FIXTURE`,
  verifiedOn: "Verified on: FIXTURE code, 2026-01-01.",
  notVerified,
  score: 2,
  text,
});

describe("KbMatchesCard", () => {
  it("labels each card with its version and asks which one the tenant runs when they differ (K12)", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          mixedVersions: true,
          results: [
            hit("401", 1, "- FIXTURE 4.x setting.", false, "4.x"),
            hit("501", 1, "- FIXTURE 5.x setting.", false, "5.x"),
          ],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    const [four, five] = within(card).getAllByRole("listitem");
    expect(within(four as HTMLElement).getByText("4.x")).toBeInTheDocument();
    expect(
      within(four as HTMLElement).getByRole("link", {
        name: /FIXTURE card 401/,
      }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/A4X/pages/401",
    );
    expect(within(five as HTMLElement).getByText("5.x")).toBeInTheDocument();
    expect(
      within(card).getByText(
        "These cards are for different Apty versions; which does this tenant run?",
      ),
    ).toBeInTheDocument();
  });

  it("searches again for the version the user picks", async () => {
    localKbMatches.mockResolvedValue({
      kind: "answer",
      packs: [],
      result: {
        status: "ok",
        mixedVersions: false,
        results: [hit("401", 1, "- FIXTURE 4.x setting.", false, "4.x")],
      },
    });
    render(
      <AptyToolDisplay
        tool={tool({
          status: "ok",
          mixedVersions: true,
          results: [
            hit("401", 1, "- FIXTURE 4.x setting.", false, "4.x"),
            hit("501", 1, "- FIXTURE 5.x setting.", false, "5.x"),
          ],
        })}
      />,
    );
    const versions = screen.getByRole("radiogroup", { name: "Apty version" });
    fireEvent.click(within(versions).getByRole("radio", { name: "4.x" }));
    await screen.findByRole("link", { name: /FIXTURE card 401/ });
    expect(localKbMatches).toHaveBeenCalledWith(
      "the tooltip opens twice",
      undefined,
      { version: "4.x", modelAvailable: true },
    );
    expect(screen.queryByRole("link", { name: /FIXTURE card 501/ })).toBeNull();
    expect(screen.queryByText(/different Apty versions/)).toBeNull();
  });

  it("tells the user the cards are in English when the question is not", () => {
    render(
      <AptyToolDisplay tool={tool({ status: "non_english", results: [] })} />,
    );
    expect(
      screen.getByText(
        "The KB cards are in English. Ask in English, or send the question to the model.",
      ),
    ).toBeInTheDocument();
  });

  it("says the KB has a card whose text is not written yet, with its link", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "stub",
          stub: {
            cite: "kb://303",
            title: "FIXTURE gadget export never finishes",
            site: "fixture.atlassian.net",
            space: "A4X",
            aptyVersion: "4.x",
          },
          results: [],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "KB cards that match" });
    expect(
      within(card).getByText(
        "The KB has a card for this, but its 4.x text is not written yet.",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: /FIXTURE gadget export/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.net/wiki/spaces/A4X/pages/303",
    );
  });

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
      "https://fixture.atlassian.net/wiki/spaces/JX/pages/202",
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

describe("KB matches card for a pack that is not used (KB-RAG K23 P5)", () => {
  it("shows one line with the reason and the date, and no card", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "pack_unusable",
          unusable: {
            reason: "expired",
            aptyVersion: "4.x",
            date: "2027-01-10T00:00:00.000Z",
          },
          results: [],
        })}
      />,
    );
    expect(screen.getByTestId("kb-pack-unusable")).toHaveTextContent(
      "The 4.x pack expired on 2027-01-10. Ask the KB owner for a new one.",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("KB matches card for a feature not in this version (KB-RAG K25, A4)", () => {
  it("says it does not exist in that version, with the reason and the card's link, and no other card", () => {
    render(
      <AptyToolDisplay
        tool={tool({
          status: "not_in_version",
          absent: {
            cite: "kb://909",
            title: "FIXTURE drop-off funnel chart",
            site: "fixture.atlassian.invalid",
            space: "FX",
            aptyVersion: "4.x",
            absentReason: "FIXTURE: the funnel chart arrived with 5.x.",
          },
          results: [],
        })}
      />,
    );
    const block = screen.getByTestId("kb-not-in-version");
    expect(block).toHaveTextContent("This does not exist in Apty 4.x.");
    expect(block).toHaveTextContent(
      "FIXTURE: the funnel chart arrived with 5.x.",
    );
    expect(
      screen.getByRole("link", { name: /FIXTURE drop-off funnel chart/ }),
    ).toHaveAttribute(
      "href",
      "https://fixture.atlassian.invalid/wiki/spaces/FX/pages/909",
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
