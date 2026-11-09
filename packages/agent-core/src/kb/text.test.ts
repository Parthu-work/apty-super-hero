import { describe, expect, it } from "vitest";
import { KB_SYNONYM_GROUPS } from "./synonyms.js";
import { analyze, createSynonymTable } from "./text.js";

describe("analyze", () => {
  it("keeps a file name whole, with its id normalized, and its parts", () => {
    expect(analyze("flow-123.json failed")).toEqual([
      "flow-id.json",
      "flow",
      "id",
      "json",
      "fail",
    ]);
    expect(analyze("app-urls.json")).toEqual([
      "app-urls.json",
      "app",
      "url",
      "json",
    ]);
    expect(
      analyze("workflow-0c000000-0000-7000-8000-000000000002.json")[0],
    ).toBe("workflow-id.json");
    expect(analyze("flow-ID.json")[0]).toBe("flow-id.json");
    expect(analyze("player.js")[0]).toBe("player.js");
  });

  it("stems words, and reads doesn't as does not", () => {
    expect(analyze("The tooltips doesn't open")).toEqual(["tooltip", "open"]);
  });
});

describe("createSynonymTable", () => {
  const table = createSynonymTable(KB_SYNONYM_GROUPS);

  it("names a group by a member's stem or by a several-word member in the text", () => {
    const [byWord] = table.groupsIn(["refresh"], "refresh");
    expect(table.words(byWord as number)).toContain("reload");
    const [byPhrase] = table.groupsIn([], "it keeps coming back every day");
    expect(table.words(byPhrase as number)).toContain("repeat");
    expect(table.groupsIn([], "the uncrashed tab").size).toBe(0);
  });

  it("adds a pack's own groups", () => {
    const own = createSynonymTable([["FIXTURE-gizmo", "gadget"]]);
    expect(own.groupsIn(["gadget"], "fixture-gizmo").size).toBe(1);
  });
});
