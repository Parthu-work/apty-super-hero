import { describe, expect, it } from "vitest";
import { kbReturnedCards, linkKbCitations } from "./kb-citations";

const PAGE = "https://apty.atlassian.net/wiki/spaces/JA/pages/";

describe("linkKbCitations", () => {
  it("links a bare citation and a Markdown link to the card's page", () => {
    expect(linkKbCitations("Turn it on (kb://101#L1).")).toBe(
      `Turn it on ([kb://101#L1](${PAGE}101)).`,
    );
    expect(linkKbCitations("See [the card](kb://202#L3).")).toBe(
      `See [the card](${PAGE}202).`,
    );
    expect(linkKbCitations("[kb://5#L2](kb://5#L2)")).toBe(
      `[kb://5#L2](${PAGE}5)`,
    );
  });

  it("labels a bare citation as asked", () => {
    expect(
      linkKbCitations(
        "Turn it on kb://101#L1.",
        (p, l) => `card ${p}, layer ${l}`,
      ),
    ).toBe(`Turn it on [card 101, layer 1](${PAGE}101).`);
  });

  it("links each citation to the card the turn's search returned, in its own space (K12)", () => {
    const urlOf = (pageId: string) =>
      pageId === "401"
        ? "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/401"
        : undefined;
    expect(linkKbCitations("Turn it on (kb://401#L1).", undefined, urlOf)).toBe(
      "Turn it on ([kb://401#L1](https://apty.atlassian.net/wiki/spaces/A4PKH/pages/401)).",
    );
  });

  it("leaves code, other schemes and incomplete citations as written", () => {
    const text =
      "`kb://1#L1` and\n```\nkb://2#L2\n```\nkb://3#L9, kb://abc#L1, kb://4";
    expect(linkKbCitations(text)).toBe(text);
    expect(linkKbCitations("no citation here")).toBe("no citation here");
  });
});

describe("kbReturnedCards", () => {
  it("reads each card a search_kb result returned, with its link and chunk text", () => {
    const cards = kbReturnedCards([
      { type: "text", text: "x" },
      {
        type: "tool",
        toolName: "search_kb",
        output: {
          status: "ok",
          results: [
            {
              cite: "kb://401#L1",
              site: "apty.atlassian.net",
              space: "A4PKH",
              text: "- FIXTURE: turn on the Beacon Switch.",
            },
          ],
        },
      },
      {
        type: "tool",
        toolName: "search_kb",
        output: {
          status: "stub",
          stub: {
            cite: "kb://402",
            site: "apty.atlassian.net",
            space: "A4PKH",
          },
          results: [],
        },
      },
      { type: "tool", toolName: "click", output: { cite: "kb://9#L1" } },
    ]);
    expect([...cards.urls]).toEqual([
      ["401", "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/401"],
      ["402", "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/402"],
    ]);
    expect(cards.texts).toEqual(["- FIXTURE: turn on the Beacon Switch."]);
    expect(cards.searched).toBe(true);
  });
});
