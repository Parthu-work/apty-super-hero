import { describe, expect, it } from "vitest";
import { toUrlShape } from "./value-shapes.js";

describe("toUrlShape", () => {
  it("keeps the path through the strict policy and the query as names only", () => {
    expect(
      toUrlShape(
        "https://ehr.example.test/patients/1234567/chart?mrn=884213&tab=notes#top",
      ),
    ).toBe("https://ehr.example.test/patients/:id/chart?mrn&tab");
  });

  it("keeps only the scheme and media type of a URL that carries its own content", () => {
    expect(toUrlShape("data:text/html,<p>Jane Doe, MRN 884213</p>")).toBe(
      "data:text/html",
    );
    expect(toUrlShape("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png",
    );
    expect(toUrlShape("data:,jane@example.com")).toBe("data:");
    expect(toUrlShape("javascript:openChart('884213')")).toBe("javascript:");
  });
});
