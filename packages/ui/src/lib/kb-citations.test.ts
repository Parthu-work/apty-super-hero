import { describe, expect, it } from "vitest";
import { linkKbCitations } from "./kb-citations";

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

  it("leaves code, other schemes and incomplete citations as written", () => {
    const text =
      "`kb://1#L1` and\n```\nkb://2#L2\n```\nkb://3#L9, kb://abc#L1, kb://4";
    expect(linkKbCitations(text)).toBe(text);
    expect(linkKbCitations("no citation here")).toBe("no citation here");
  });
});
