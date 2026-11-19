import { describe, expect, it } from "vitest";
import { checkForCard } from "./check-cards";
import { CARD_PAGE_ID } from "./content-not-visible";
import { routeCheck, routeSymptom } from "./router";

describe("the check a KB card's symptom belongs to (KB-RAG K27, E5)", () => {
  it("maps each check's own card to its pack, with the content kind the question names", () => {
    expect(checkForCard(CARD_PAGE_ID, "my tooltip vanished")).toEqual({
      packId: "content-not-visible",
      kind: "tooltip",
    });
    expect(checkForCard(CARD_PAGE_ID, "the tour vanished")).toEqual({
      packId: "content-not-visible",
      kind: "workflow",
    });
    expect(checkForCard("1509720308", "gone")).toEqual({
      packId: "content-not-visible",
      kind: "workflow",
    });
    expect(checkForCard("1496645690", "x")).toEqual({
      packId: "widget-not-visible",
    });
    expect(checkForCard("1509785878", "x")).toEqual({
      packId: "widget-not-visible",
    });
    expect(checkForCard("1496875202", "x")).toEqual({
      packId: "page-readiness",
    });
  });

  it("offers a selector check only when the question names what to check, and nothing for a card no check reads", () => {
    expect(checkForCard("1496286045", "the launcher points nowhere")).toEqual({
      packId: "element-not-found",
      kind: "launcher",
    });
    expect(checkForCard("1496286045", "it points nowhere")).toBeUndefined();
    expect(checkForCard("101", "my workflow vanished")).toBeUndefined();
  });
});

describe("routeCheck: a requested check on the SE's own words (KB-RAG K27, E5)", () => {
  it("runs the requested pack even when the words do not route, keeping the item's name", () => {
    const message = "the 'Take a tour' workflow vanished after Friday";
    expect(routeSymptom(message)).toBeUndefined();
    expect(
      routeCheck(message, { packId: "content-not-visible", kind: "workflow" }),
    ).toEqual({
      packId: "content-not-visible",
      kind: "workflow",
      query: "Take a tour",
    });
    expect(routeCheck(message, { packId: "widget-not-visible" })).toEqual({
      packId: "widget-not-visible",
    });
    expect(
      routeCheck("apty causes 404s", { packId: "logs-and-errors" }),
    ).toEqual({ packId: "logs-and-errors", about404: true });
  });

  it("refuses a pack or kind it does not know, so a crafted request runs nothing", () => {
    expect(routeCheck("x", { packId: "dapty-conversation" })).toBeUndefined();
    expect(routeCheck("x", { packId: "no-such-pack" })).toBeUndefined();
    expect(
      routeCheck("x", { packId: "content-not-visible", kind: "nothing" }),
    ).toBeUndefined();
    expect(routeCheck("x", { packId: "element-not-found" })).toBeUndefined();
  });
});
