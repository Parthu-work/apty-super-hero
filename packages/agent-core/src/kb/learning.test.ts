import { describe, expect, it } from "vitest";
import { proposeSynonyms, searchCardTitles } from "./learning.js";

const CARDS = [
  { pageId: "101", title: "FIXTURE banner never glows", aptyVersion: "5.x" },
  { pageId: "202", title: "FIXTURE tooltip opens twice", aptyVersion: "5.x" },
  { pageId: "2031", title: "Tooltips flicker on FIXTURE pages" },
];

describe("searchCardTitles (KB-RAG K27, E7)", () => {
  it("matches every word of the query by stem, in any order, ignoring case", () => {
    expect(
      searchCardTitles(CARDS, "twice TOOLTIP").map((c) => c.pageId),
    ).toEqual(["202"]);
    expect(
      searchCardTitles(CARDS, "tooltip")
        .map((c) => c.pageId)
        .sort(),
    ).toEqual(["202", "2031"]);
  });

  it("puts titles that start with the query first, then the rest", () => {
    expect(searchCardTitles(CARDS, "tooltips").map((c) => c.pageId)).toEqual([
      "2031",
      "202",
    ]);
  });

  it("finds a card by its id, the exact id first", () => {
    expect(searchCardTitles(CARDS, "20").map((c) => c.pageId)).toEqual([
      "202",
      "2031",
    ]);
    expect(searchCardTitles(CARDS, "202")[0]?.pageId).toBe("202");
  });

  it("offers nothing for a word no title holds, and the first cards for an empty query", () => {
    expect(searchCardTitles(CARDS, "segment")).toEqual([]);
    expect(searchCardTitles(CARDS, "  ", 2)).toHaveLength(2);
  });
});

describe("proposeSynonyms (KB-RAG K27, E7)", () => {
  const text: Record<string, string> = {
    "202":
      "FIXTURE tooltip opens twice. Clear the FIXTURE Double Trigger setting.",
  };
  const cardText = (pageId: string) => text[pageId];

  it("lists the question words the right card does not hold, counted per question", () => {
    expect(
      proposeSynonyms(
        [
          {
            question: "the hint bubble pops up twice",
            rightCardId: "202",
            aptyVersion: "5.x",
          },
          {
            question: "hint bubble shows double, bubble again",
            rightCardId: "202",
            aptyVersion: "5.x",
          },
        ],
        cardText,
      ),
    ).toEqual([
      {
        cardId: "202",
        aptyVersion: "5.x",
        words: [
          { word: "bubble", count: 2 },
          { word: "hint", count: 2 },
          { word: "again", count: 1 },
          { word: "pops", count: 1 },
          { word: "shows", count: 1 },
        ],
      },
    ]);
  });

  it("treats an inflected form the card holds as held", () => {
    expect(
      proposeSynonyms(
        [{ question: "tooltips opening twice", rightCardId: "202" }],
        cardText,
      ),
    ).toEqual([]);
  });

  it("never proposes a redaction placeholder or a number, and skips a card it cannot read", () => {
    expect(
      proposeSynonyms(
        [
          {
            question: "<REDACTED-EMAIL> [WITHHELD] sees 4031 balloon",
            rightCardId: "202",
          },
          { question: "balloon again", rightCardId: "999" },
        ],
        cardText,
      ),
    ).toEqual([
      {
        cardId: "202",
        words: [
          { word: "balloon", count: 1 },
          { word: "sees", count: 1 },
        ],
      },
    ]);
  });
});
