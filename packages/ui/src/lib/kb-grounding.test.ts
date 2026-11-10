import { describe, expect, it } from "vitest";
import { markUngrounded, ungroundedPhrases } from "./kb-grounding";

const CHUNKS = [
  "- In Studio, turn on the FIXTURE Hide From Widget switch, then publish.",
  "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
];

describe("ungroundedPhrases", () => {
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
