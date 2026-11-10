import { describe, expect, it } from "vitest";
import { KB_SYNONYM_GROUPS } from "./synonyms.js";
import {
  analyze,
  createPhraseLookup,
  createSynonymTable,
  namedPhrases,
} from "./text.js";

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

describe("F1: namedPhrases", () => {
  it("names a quoted phrase, and a Title Case run near a setting cue", () => {
    expect(namedPhrases("where is the Widget Activation toggle")).toEqual([
      "Widget Activation",
    ]);
    expect(namedPhrases("turn on the Allowed Domains setting")).toEqual([
      "Allowed Domains",
    ]);
    expect(namedPhrases("I turned off the Glow Pulse for it")).toEqual([
      "Glow Pulse",
    ]);
    expect(namedPhrases("the 'Smart Sync' option")).toEqual(["Smart Sync"]);
  });

  it("leaves a Title Case run with no setting cue nearby alone", () => {
    expect(
      namedPhrases("the balloon does not appear on the Admin Portal page"),
    ).toEqual([]);
    expect(
      namedPhrases(
        "the Admin Portal page loads; the toggle is far away from it",
      ),
    ).toEqual([]);
  });

  it("names every Title Case run when asked to, as an answer's grounding check does", () => {
    expect(
      namedPhrases("then check the Allowed Domains list", { everyRun: true }),
    ).toEqual(["Allowed Domains"]);
    expect(
      namedPhrases("see Google Chrome and Salesforce Lightning", {
        everyRun: true,
      }),
    ).toEqual([]);
  });

  it("never names browser, platform or customer application terms", () => {
    expect(
      namedPhrases("I turned on Developer Mode and the player freezes"),
    ).toEqual([]);
    expect(namedPhrases("enable Preserve Log in the Network Tab")).toEqual([]);
    expect(
      namedPhrases("the option is off in Salesforce Lightning on Windows"),
    ).toEqual([]);
    expect(namedPhrases("set the Salesforce Glow Mode option")).toEqual([
      "Salesforce Glow Mode",
    ]);
  });
});

describe("createPhraseLookup", () => {
  it("finds a phrase's terms in a row in any stream", () => {
    const holds = createPhraseLookup([
      analyze("FIXTURE banner glows"),
      analyze("turn on the Glowing Banner setting"),
    ]);
    expect(holds("Glowing Banner")).toBe(true);
    expect(holds("banner glows")).toBe(true);
    expect(holds("Setting Glowing")).toBe(false);
    expect(holds("Smart Sync")).toBe(false);
  });
});
