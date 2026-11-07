import { describe, expect, it } from "vitest";
import { cardLayerOf } from "./card-layers.js";

describe("cardLayerOf", () => {
  it("reads the settings layer for a settings cause and the data layer for a data cause", () => {
    expect(cardLayerOf("CNV-03")).toBe(1);
    expect(cardLayerOf("WNV-02")).toBe(1);
    expect(cardLayerOf("LOG-05")).toBe(3);
    expect(cardLayerOf("CNV-08")).toBe(3);
    expect(cardLayerOf("WNV-01")).toBe(3);
  });

  it("reads the Console and Elements layer for a page or element cause", () => {
    expect(cardLayerOf("SEL-07")).toBe(2);
    expect(cardLayerOf("DOM-05")).toBe(2);
    expect(cardLayerOf("LOG-04")).toBe(2);
  });

  it("reads the settings layer when a log says no environment matches", () => {
    expect(cardLayerOf("LOG-01")).toBe(1);
    expect(cardLayerOf("LOG-03")).toBe(1);
  });
});
