import { MASKED_VALUE } from "@apty/dom-snapshot";
import { describe, expect, it } from "vitest";
import {
  capSnapshotText,
  describeEditorValue,
  describePageMetadata,
  SNAPSHOT_MAX_TOKENS,
} from "./value-results";

describe("describeEditorValue", () => {
  it("returns the value and its length when showing", () => {
    expect(describeEditorValue("select 1", "show")).toEqual({
      success: true,
      value: "select 1",
      length: 8,
    });
  });

  it("returns a mask without the length when masking, and an empty value stays empty", () => {
    expect(describeEditorValue("Jane", "mask")).toEqual({
      success: true,
      value: MASKED_VALUE,
      masked: true,
    });
    expect(describeEditorValue("", "mask")).toEqual({
      success: true,
      value: "",
      masked: true,
    });
  });

  it("refuses with a reason the model can pass on when withholding", () => {
    const result = describeEditorValue("Jane", "withhold");
    expect(result).toMatchObject({ success: false, withheld: true });
    expect(JSON.stringify(result)).not.toContain("Jane");
    expect(result).toHaveProperty("message");
    expect((result as { message: string }).message).toMatch(/Data handling/);
  });
});

describe("describePageMetadata", () => {
  const meta = {
    title: "Chart",
    url: "https://app.example.com/chart?mrn=123#tab",
    description: "Open chart",
    ogImage: "https://cdn.example.com/a.png?sig=abc",
    favicon: "https://app.example.com/favicon.ico",
  };

  it("leaves the page's own words alone and applies the policy to its URLs", () => {
    expect(describePageMetadata(meta, "withhold")).toEqual({
      ...meta,
      url: "https://app.example.com/chart",
      ogImage: "https://cdn.example.com/a.png",
    });
    expect(describePageMetadata(meta, "mask")).toMatchObject({
      url: `https://app.example.com/chart?mrn=${MASKED_VALUE}`,
      title: "Chart",
    });
  });

  it("is unchanged when showing, and passes a missing page through", () => {
    expect(describePageMetadata(meta, "show")).toEqual(meta);
    expect(describePageMetadata(null, "withhold")).toBeNull();
  });
});

describe("capSnapshotText", () => {
  it("leaves a snapshot within the cap alone", () => {
    const text = "line\n".repeat(100);
    expect(capSnapshotText(text)).toBe(text);
  });

  it("cuts at a line boundary, says how much was cut and points to search_elements", () => {
    const text = `${"a snapshot line of some length\n".repeat(2000)}`;
    const capped = capSnapshotText(text);
    expect(capped.length).toBeLessThan(SNAPSHOT_MAX_TOKENS * 4 + 300);
    const body = capped.slice(0, capped.indexOf("\n[snapshot truncated"));
    expect(body.endsWith("a snapshot line of some length")).toBe(true);
    expect(capped).toMatch(
      /\[snapshot truncated: .* of 2000 lines.*search_elements/,
    );
  });
});
