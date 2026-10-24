import { describe, expect, it } from "vitest";
import { analyze, profile, run, values } from "./__tests__/fixtures";
import { recordKindOf } from "./classify";
import { generateRules } from "./generate-rules";

function twoRuns(
  first: Record<string, Record<string, number>>,
  second: Record<string, Record<string, number>> = first,
) {
  return analyze([
    run("initial", profile(first)),
    run("after-reload", profile(second)),
  ]);
}

describe("classifyPage", () => {
  it("puts every value in its bucket", () => {
    const shared = {
      class: values(
        "apty-widget-frame",
        "tether-element",
        "ui-state-active",
        "ag-row-even",
        "RptTable",
      ),
      "aria-expanded": values("true"),
      width: values("100%"),
      title: values("jane.doe@example.com"),
      "data-row-id": values("98765"),
      name: values("firstName"),
    };
    const { bucketOf } = twoRuns(
      {
        ...shared,
        id: values("provCheck_1009116120", "ui-id-1", "ui-id-2", "home-table"),
        href: values("/patients/1234567/chart", "/a?nocache=1"),
      },
      {
        ...shared,
        id: values("provCheck_1009116120", "ui-id-1", "ui-id-2", "home-table"),
        href: values("/patients/1234567/chart", "/a?nocache=2"),
      },
    );
    expect(bucketOf("class", "apty-widget-frame")).toBe("noise");
    expect(bucketOf("id", "provCheck_1009116120")).toBe("covered-by-defaults");
    expect(bucketOf("class", "tether-element")).toBe("covered-by-defaults");
    expect(bucketOf("href", "/a?nocache=1")).toBe("observed-change");
    expect(bucketOf("id", "ui-id-1")).toBe("pattern");
    expect(bucketOf("href", "/patients/1234567/chart")).toBe("record-specific");
    expect(bucketOf("data-row-id", "98765")).toBe("record-specific");
    expect(bucketOf("aria-expanded", "true")).toBe("state-driven");
    expect(bucketOf("class", "ui-state-active")).toBe("state-driven");
    expect(bucketOf("class", "ag-row-even")).toBe("state-driven");
    expect(bucketOf("width", "100%")).toBe("layout-only");
    expect(bucketOf("title", "jane.doe@example.com")).toBe("pii");
    expect(bucketOf("id", "home-table")).toBe("stable");
    expect(bucketOf("class", "RptTable")).toBe("stable");
  });

  it("leaves ui-id-1 to the pattern rule while Apty's default already ignores provCheck ids", () => {
    const { bucketOf } = twoRuns({
      id: values("ui-id-1", "provCheck_1009116120"),
    });
    expect(bucketOf("id", "provCheck_1009116120")).toBe("covered-by-defaults");
    expect(bucketOf("id", "ui-id-1")).toBe("stable");
  });

  it("applies the buckets in order: a change outranks a pattern, a state name and a PII shape", () => {
    const { bucketOf, classified } = twoRuns(
      {
        autocomplete: values("off_1729700000111", "off_1729700000999"),
        "aria-controls": values("menu-1"),
        title: values("555-123-4567"),
      },
      {
        autocomplete: values("off_1729700000222", "off_1729700000999"),
        "aria-controls": values("menu-2"),
        title: values("555-123-9999"),
      },
    );
    expect(bucketOf("autocomplete", "off_1729700000111")).toBe(
      "observed-change",
    );
    expect(bucketOf("autocomplete", "off_1729700000999")).toBe("pattern");
    expect(bucketOf("aria-controls", "menu-1")).toBe("observed-change");
    expect(bucketOf("title", "555-123-4567")).toBe("observed-change");
    expect(classified.items.find((i) => i.value === "555-123-4567")?.pii).toBe(
      "phone",
    );
  });

  it("names the query parameter that changed for the same link", () => {
    const { classified } = twoRuns(
      { href: values("/visits?visitDate=10/22/2026&tab=open") },
      { href: values("/visits?visitDate=10/23/2026&tab=open") },
    );
    expect(classified.items.map((i) => i.changedParams)).toEqual([
      ["visitDate"],
      ["visitDate"],
    ]);
  });

  it("marks a value verified only when every compared run had it", () => {
    const { classified } = analyze([
      run("initial", profile({ id: values("a") })),
    ]);
    expect(classified.items[0]).toMatchObject({
      bucket: "stable",
      verified: false,
    });
    const compared = twoRuns({ id: values("a") });
    expect(compared.classified.items[0]).toMatchObject({
      bucket: "stable",
      verified: true,
    });
  });
});

describe("recordKindOf", () => {
  it("recognises record numbers, GUIDs, timestamps and long hex ids", () => {
    expect(recordKindOf("/p/12345")).toBe("digits");
    expect(recordKindOf("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("guid");
    expect(recordKindOf("at=2026-10-23T10:15")).toBe("timestamp");
    expect(recordKindOf("doc-a1b2c3d4e5f6a7b8c9")).toBe("hex");
    expect(recordKindOf("/p/1234")).toBeNull();
  });

  it("does not read a port as a record number, and still finds one in the same URL", () => {
    expect(recordKindOf("http://localhost:49321/frame.html")).toBeNull();
    expect(recordKindOf("http://[::1]:49321/frame.html")).toBeNull();
    expect(recordKindOf("open http://localhost:49321 first")).toBeNull();
    expect(recordKindOf("https://docs.example.test:49321/viewer/1234567")).toBe(
      "digits",
    );
    expect(recordKindOf("/patients/49321")).toBe("digits");
  });
});

describe("a frame src with a port", () => {
  it("is stable, not a record or a PII value, and gives no rule; a record id beside it still does", () => {
    const page = twoRuns({
      src: values("http://localhost:49321/frame.html"),
      href: values("/patients/1234567/chart"),
    });
    expect(page.bucketOf("src", "http://localhost:49321/frame.html")).toBe(
      "stable",
    );
    expect(page.classified.items.find((i) => i.name === "src")?.pii).toBeNull();
    expect(page.bucketOf("href", "/patients/1234567/chart")).toBe(
      "record-specific",
    );
    const { rules } = generateRules([page.classified]);
    expect(rules.map((r) => r.conditions[0]?.value)).toEqual(["href"]);
  });
});
