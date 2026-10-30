import { describe, expect, it } from "vitest";
import {
  applyUrlPolicy,
  applyValuePolicy,
  ID_RUN,
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

  it("replaces record numbers, GUIDs, long hex ids and emails in the path when withholding", () => {
    expect(
      applyUrlPolicy(
        "https://ehr.example.com/patients/884213/notes/3f2b9c1e-8a4d-4c2e-9b7f-1a2b3c4d5e6f/v/0123456789abcdef0123?x=1",
        "withhold",
      ),
    ).toBe("https://ehr.example.com/patients/:id/notes/:id/v/:id");
    expect(
      applyUrlPolicy(
        "https://app.example.com/users/jane.doe@example.com/profile",
        "withhold",
      ),
    ).toBe("https://app.example.com/users/:email/profile");
  });

  it("keeps short numbers and words in the path, and the path itself when masking", () => {
    expect(
      applyUrlPolicy("https://app.example.com/v2/orders/42/page/7", "withhold"),
    ).toBe("https://app.example.com/v2/orders/42/page/7");
    expect(
      applyUrlPolicy("https://app.example.com/patients/884213", "mask"),
    ).toBe("https://app.example.com/patients/884213");
  });

  it("leaves a URL with no query or fragment alone, in every policy", () => {
    const plain = "https://app.example.com/chart/42";
    for (const policy of ["show", "mask", "withhold"] as const) {
      expect(applyUrlPolicy(plain, policy)).toBe(plain);
    }
  });

  it("returns an unparsable URL as empty, never its raw text, rather than throwing", () => {
    expect(
      applyUrlPolicy("https://[patients/884213?mrn=884213", "withhold"),
    ).toBe("");
    expect(applyUrlPolicy("https://[patients/884213?mrn=884213", "mask")).toBe(
      "",
    );
    expect(applyUrlPolicy(undefined, "mask")).toBeUndefined();
  });
});

describe("applyUrlPolicy beyond absolute web URLs", () => {
  const RELATIVE = "/patients/884213/chart?mrn=884213#top";

  it("masks a relative URL as text, like an absolute one", () => {
    expect(applyUrlPolicy(RELATIVE, "withhold")).toBe("/patients/:id/chart");
    expect(applyUrlPolicy(RELATIVE, "mask")).toBe(
      "/patients/884213/chart?mrn=[masked]",
    );
  });

  it("never re-encodes or normalizes a relative value", () => {
    expect(applyUrlPolicy("/html/body/div[3]/../a b", "withhold")).toBe(
      "/html/body/div[3]/../a b",
    );
  });

  it("keeps a protocol-relative URL protocol-relative", () => {
    expect(
      applyUrlPolicy("//cdn.example.com/patients/884213?mrn=1", "withhold"),
    ).toBe("//cdn.example.com/patients/:id");
  });

  it("masks a file: URL like any other and never gives null as its origin", () => {
    const file = "file:///patients/884213/chart?mrn=884213";
    expect(applyUrlPolicy(file, "withhold")).toBe("file:///patients/:id/chart");
    expect(applyUrlPolicy(file, "mask")).toBe(
      "file:///patients/884213/chart?mrn=[masked]",
    );
  });

  it("keeps browser and extension pages readable", () => {
    expect(applyUrlPolicy("chrome://extensions", "withhold")).toBe(
      "chrome://extensions",
    );
    expect(
      applyUrlPolicy(
        "chrome-extension://bpiondflhhdplemamgggcdajclmoeple/src/entrypoints/sidepanel/index.html",
        "withhold",
      ),
    ).toBe(
      "chrome-extension://bpiondflhhdplemamgggcdajclmoeple/src/entrypoints/sidepanel/index.html",
    );
    expect(applyUrlPolicy("about:blank", "withhold")).toBe("about:blank");
  });
});

describe("withheld paths", () => {
  /** What withholding did before the email scan: one global replace, quadratic on a long run without an `@`. */
  const globalReplace = (path: string) =>
    path
      .replace(/[^/@\s]+@[^/@\s]+\.[a-z]{2,}/gi, ":email")
      .replace(ID_RUN, ":id");

  it("replaces emails exactly as the global replace did", () => {
    const pieces = [
      "a",
      "Z",
      "1",
      ".",
      "@",
      "/",
      " ",
      "\u00a0",
      "É",
      "-",
      "co",
      "x@y.org",
    ];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed;
    };
    for (let i = 0; i < 5_000; i++) {
      let path = "/p/";
      for (let n = next() % 16; n > 0; n--) {
        path += pieces[next() % pieces.length];
      }
      expect(applyUrlPolicy(path, "withhold")).toBe(globalReplace(path));
    }
  });

  it("withholds a 100,000-character path in linear time", () => {
    const started = performance.now();
    for (const path of [
      `/${"!".repeat(100_000)}`,
      `/${"!".repeat(100_000)}@`,
      `/a@${"b.".repeat(50_000)}`,
    ]) {
      applyUrlPolicy(path, "withhold");
    }
    expect(performance.now() - started).toBeLessThan(500);
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

describe("prepareNodeForPolicy and the page itself (M2)", () => {
  it("withholds the page title the snapshot root carries in Strict, and keeps it in Standard", () => {
    const root = {
      role: "RootWebArea",
      name: "Jane Testpatient - Chart",
      children: [],
    };

    expect(prepareNodeForPolicy(root, "withhold").name).toBe(
      "[title withheld]",
    );
    expect(prepareNodeForPolicy(root, "mask").name).toBe(
      "Jane Testpatient - Chart",
    );
  });

  it("treats a region marked editable as a field: its text is not sent in Strict", () => {
    const region = {
      role: "generic",
      editable: true,
      children: [
        { role: "StaticText", name: "Editor-Marker-Seven", children: [] },
      ],
    };

    expect(prepareNodeForPolicy(region, "withhold").children).toEqual([]);
  });
});
