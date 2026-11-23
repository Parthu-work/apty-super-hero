import { describe, expect, it } from "vitest";
import {
  markUngrounded,
  ungroundedLocations,
  ungroundedPhrases,
} from "./kb-grounding";

const CHUNKS = [
  "- In Studio, turn on the FIXTURE Hide From Widget switch, then publish.",
  "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
];

describe("ungroundedPhrases", () => {
  it("flags a menu path on a turn with no KB card, as one phrase (K27, F2)", () => {
    expect(
      ungroundedPhrases(
        "Go to Admin Portal → Applications → Settings and open Widget Gadget.",
        [],
      ),
    ).toEqual(["Admin Portal → Applications → Settings", "Widget Gadget"]);
    expect(
      ungroundedPhrases("Open Studio > Hide From Widget to change it.", [
        "- In Studio, turn on the FIXTURE Hide From Widget switch.",
      ]),
    ).toEqual([]);
  });

  it("flags a setting name that no returned chunk holds", () => {
    expect(
      ungroundedPhrases(
        "Open Studio and turn off Widget Activation, then check the Allowed Domains list (kb://101#L1).",
        CHUNKS,
      ),
    ).toEqual(["Widget Activation", "Allowed Domains"]);
  });

  it("does not flag a setting the chunk holds, in another case or form", () => {
    expect(
      ungroundedPhrases(
        'In Studio, clear **Hide From Widget** and publish; "hide from widgets" stays off.',
        CHUNKS,
      ),
    ).toEqual([]);
  });

  it("ignores code, links, a sentence's first word, headings and names that are not settings", () => {
    expect(
      ungroundedPhrases(
        [
          "## Fix Steps",
          "Run `Widget Activation.enable()` in DevTools Console.",
          "```",
          "Allowed Domains = []",
          "```",
          "See [the help page](https://example.com) and Google Chrome.",
          "Salesforce Lightning pages need it too.",
        ].join("\n"),
        CHUNKS,
      ),
    ).toEqual([]);
  });

  it("is the same every time, and flags nothing without an answer", () => {
    const answer = "Then turn on Beacon Pulse Mode.";
    expect(ungroundedPhrases(answer, CHUNKS)).toEqual(["Beacon Pulse Mode"]);
    expect(ungroundedPhrases(answer, CHUNKS)).toEqual(
      ungroundedPhrases(answer, CHUNKS),
    );
    expect(ungroundedPhrases("", CHUNKS)).toEqual([]);
  });
});

describe("the reply after Ask the AI anyway (KB-RAG K29, B6)", () => {
  const REPLY = [
    'I could not find a "Widget Activation" setting in the Apty KB.',
    "The toggle may be in the application settings, widget configuration, or environment settings area.",
    "Ask Apty Support or the KB owner, or check Apty Studio and Apty Admin in Chrome or Edge; Confluence may help.",
  ].join(" ");

  it("flags only the setting name, never a product or role name", () => {
    expect(ungroundedPhrases(REPLY, [])).toEqual(["Widget Activation"]);
  });

  it("flags the sentence that says where the setting might be", () => {
    expect(ungroundedLocations(REPLY, [])).toEqual([
      "The toggle may be in the application settings, widget configuration, or environment settings area.",
    ]);
    expect(
      ungroundedLocations("The KB has no such setting; ask the KB owner.", []),
    ).toEqual([]);
  });

  it("leaves a location to a turn whose KB cards could hold it", () => {
    expect(
      ungroundedLocations(REPLY, ["- In Studio, open the FIXTURE settings."]),
    ).toEqual([]);
  });
});

describe("markUngrounded", () => {
  it("underlines each phrase outside code and links, keeps the text, and is idempotent", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<p>Turn off Widget Activation now, then widget activation again.</p><p><code>Widget Activation</code> <a href='#'>Widget Activation</a></p>";
    const before = root.textContent;
    markUngrounded(
      root,
      ["Widget Activation"],
      "Not found in the cited KB cards",
    );
    markUngrounded(
      root,
      ["Widget Activation"],
      "Not found in the cited KB cards",
    );
    const marks = root.querySelectorAll("[data-kb-ungrounded]");
    expect([...marks].map((m) => m.textContent)).toEqual([
      "Widget Activation",
      "widget activation",
    ]);
    expect(marks[0]?.getAttribute("title")).toBe(
      "Not found in the cited KB cards",
    );
    expect(root.textContent).toBe(before);
  });
});
