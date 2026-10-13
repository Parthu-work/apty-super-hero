import { describe, expect, it } from "vitest";
import {
  applyUrlPolicy,
  applyValuePolicy,
  isEditableRole,
  MASKED_VALUE,
  prepareNodeForPolicy,
} from "./value-policy.js";

describe("applyValuePolicy", () => {
  it("shows a value as it is", () => {
    expect(applyValuePolicy("Jane Testpatient", "show")).toBe(
      "Jane Testpatient",
    );
  });

  it("masks a non-empty value but keeps an empty one empty, so a filled field is distinguishable", () => {
    expect(applyValuePolicy("Jane Testpatient", "mask")).toBe(MASKED_VALUE);
    expect(applyValuePolicy("", "mask")).toBe("");
    expect(applyValuePolicy(undefined, "mask")).toBeUndefined();
  });

  it("withholds the value entirely", () => {
    expect(applyValuePolicy("Jane Testpatient", "withhold")).toBeUndefined();
    expect(applyValuePolicy("", "withhold")).toBeUndefined();
  });

  it("never reveals the length of what it masks", () => {
    expect(applyValuePolicy("a", "mask")).toBe(
      applyValuePolicy("a much longer value", "mask"),
    );
  });
});

describe("applyUrlPolicy", () => {
  const url = "https://app.example.com/chart/42?mrn=12345&tab=labs#token=abc";

  it("shows the whole URL", () => {
    expect(applyUrlPolicy(url, "show")).toBe(url);
  });

  it("masks query values and drops the fragment, keeping the keys", () => {
    expect(applyUrlPolicy(url, "mask")).toBe(
      `https://app.example.com/chart/42?mrn=${MASKED_VALUE}&tab=${MASKED_VALUE}`,
    );
  });

  it("keeps only origin and path when withholding", () => {
    expect(applyUrlPolicy(url, "withhold")).toBe(
      "https://app.example.com/chart/42",
    );
  });

  it("leaves a URL with no query or fragment alone, in every policy", () => {
    const plain = "https://app.example.com/chart/42";
    for (const policy of ["show", "mask", "withhold"] as const) {
      expect(applyUrlPolicy(plain, policy)).toBe(plain);
    }
  });

  it("returns something unparseable unchanged rather than throwing", () => {
    expect(applyUrlPolicy("not a url?x=1", "withhold")).toBe("not a url?x=1");
    expect(applyUrlPolicy(undefined, "mask")).toBeUndefined();
  });
});

describe("isEditableRole", () => {
  it("is true for the roles that hold what a person typed", () => {
    for (const role of ["textbox", "searchbox", "combobox", "spinbutton"]) {
      expect(isEditableRole(role)).toBe(true);
    }
    expect(isEditableRole("button")).toBe(false);
    expect(isEditableRole("StaticText")).toBe(false);
  });
});

describe("prepareNodeForPolicy", () => {
  const field = (extra = {}) => ({
    id: "n1",
    role: "textbox",
    name: "Patient name",
    value: "Jane Testpatient",
    children: [
      { id: "t1", role: "StaticText", name: "Jane Testpatient", children: [] },
      { id: "b1", role: "button", name: "Clear", children: [] },
    ],
    ...extra,
  });

  it("returns the node as it is when showing", () => {
    const node = field();
    expect(prepareNodeForPolicy(node, "show")).toBe(node);
  });

  it("masks the value and drops the text children of an editable node", () => {
    const out = prepareNodeForPolicy(field(), "mask");
    expect(out.value).toBe(MASKED_VALUE);
    expect(out.children.map((c) => c.role)).toEqual(["button"]);
    expect(out.name).toBe("Patient name");
  });

  it("withholds the value of an editable node", () => {
    const out = prepareNodeForPolicy(field(), "withhold");
    expect(out.value).toBeUndefined();
  });

  it("drops a name that was taken from the value", () => {
    const out = prepareNodeForPolicy(
      field({ name: "Jane Testpatient", nameIsValue: true }),
      "mask",
    );
    expect(out.name).toBe("");
  });

  it("keeps a name that was not taken from the value", () => {
    const out = prepareNodeForPolicy(field({ nameIsValue: false }), "withhold");
    expect(out.name).toBe("Patient name");
  });

  it("leaves a node that is not editable alone, text children included", () => {
    const node = {
      id: "p",
      role: "generic",
      name: "",
      children: [{ id: "t", role: "StaticText", name: "Hello", children: [] }],
    };
    expect(prepareNodeForPolicy(node, "withhold")).toBe(node);
  });

  describe("the chosen option of a select", () => {
    const option = (id: string, name: string, selected?: boolean) => ({
      id,
      role: "option",
      name,
      selected,
      children: [],
    });
    const list = () => ({
      id: "none",
      role: "none",
      name: "",
      children: [option("a", "Active"), option("r", "Referral-Cardio", true)],
    });

    it("keeps the options but hides which one is chosen when masking", () => {
      const out = prepareNodeForPolicy(list(), "mask");
      expect(out.children.map((c) => c.name)).toEqual(["Active", MASKED_VALUE]);
    });

    it("drops the chosen option when withholding", () => {
      const out = prepareNodeForPolicy(list(), "withhold");
      expect(out.children.map((c) => c.name)).toEqual(["Active"]);
    });

    it("returns the same node when no option is chosen or when showing", () => {
      const plain = {
        id: "none",
        role: "none",
        name: "",
        children: [option("a", "Active")],
      };
      expect(prepareNodeForPolicy(plain, "withhold")).toBe(plain);
      const chosen = list();
      expect(prepareNodeForPolicy(chosen, "show")).toBe(chosen);
    });

    it("leaves a selected tab alone: it is navigation, not a value", () => {
      const tabs = {
        id: "tl",
        role: "tablist",
        name: "",
        children: [
          { id: "t", role: "tab", name: "Labs", selected: true, children: [] },
        ],
      };
      expect(prepareNodeForPolicy(tabs, "withhold")).toBe(tabs);
    });
  });

  it("does not change the node it was given", () => {
    const node = field();
    prepareNodeForPolicy(node, "withhold");
    expect(node.value).toBe("Jane Testpatient");
    expect(node.children).toHaveLength(2);
  });
});
