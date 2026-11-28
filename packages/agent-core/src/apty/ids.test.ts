import { describe, expect, it } from "vitest";
import { idShapeIssue } from "./ids.js";

const UUID = "0f000000-0000-7000-8000-000000000000";

describe("idShapeIssue", () => {
  it("takes UUIDs for every 5.x ID", () => {
    for (const kind of ["tenant", "application", "environment"] as const) {
      expect(idShapeIssue("5.x", kind, UUID)).toBeUndefined();
      expect(idShapeIssue("5.x", kind, UUID.toUpperCase())).toBeUndefined();
      expect(idShapeIssue("5.x", kind, "prod")).toMatch(/UUID/);
    }
  });

  it("takes a short tenant key and numeric application and environment IDs on 4.x", () => {
    expect(idShapeIssue("4.x", "tenant", "yA87eWGa")).toBeUndefined();
    expect(idShapeIssue("4.x", "tenant", "dynamics365_x-1")).toBeUndefined();
    expect(idShapeIssue("4.x", "application", "18515")).toBeUndefined();
    expect(idShapeIssue("4.x", "environment", "10")).toBeUndefined();
    expect(idShapeIssue("4.x", "application", "7a")).toMatch(/number/);
    expect(idShapeIssue("4.x", "environment", UUID)).toMatch(/number/);
  });

  it("refuses percent-encoding, separators and blanks in any ID", () => {
    for (const id of ["%2e%2e", "a%2Fb", "a/b", "..", "", " 1", "a b"]) {
      expect(idShapeIssue("4.x", "tenant", id)).toBeDefined();
      expect(idShapeIssue("5.x", "tenant", id)).toBeDefined();
      expect(idShapeIssue("4.x", "environment", id)).toBeDefined();
    }
  });
});
