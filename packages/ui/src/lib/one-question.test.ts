import { describe, expect, it } from "vitest";
import { foldQuestions } from "./one-question";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe("foldQuestions (KB-RAG K28, F5)", () => {
  it("shows the first of three listed questions and folds two, losing no text", () => {
    const reply = [
      "The widget loads, but the workflow is not listed.",
      "",
      "To narrow it down:",
      "1. Which segment should see it?",
      "2. Is the workflow published?",
      "3. Does it happen for every user?",
    ].join("\n");
    const folded = foldQuestions(reply);
    expect(folded?.count).toBe(2);
    expect(folded?.shown).toBe(
      "The widget loads, but the workflow is not listed.\n\nTo narrow it down:\n1. Which segment should see it?",
    );
    expect(folded?.folded).toBe(
      "2. Is the workflow published?\n3. Does it happen for every user?",
    );
    expect(words(`${folded?.shown} ${folded?.folded}`)).toEqual(words(reply));
  });

  it("folds the questions of a closing paragraph after the first", () => {
    const reply =
      "Thanks. Which tenant is it? And which browser? Any console errors? Then I can check.";
    expect(foldQuestions(reply)).toEqual({
      shown: "Thanks. Which tenant is it?",
      folded: "And which browser? Any console errors? Then I can check.",
      count: 2,
    });
  });

  it("leaves a reply with one question unchanged", () => {
    expect(
      foldQuestions("The segment is inactive.\n\nShould I check the rules?"),
    ).toBeUndefined();
  });

  it("only reads the last paragraph or list", () => {
    expect(
      foldQuestions("Is it 4.x? Or 5.x?\n\nI checked the files. Is it fixed?"),
    ).toBeUndefined();
  });

  it("ignores questions inside code, block quotes and quotation marks", () => {
    expect(
      foldQuestions(
        'Run this:\n\n```\nconsole.log("a?"); x ? y : z;\nwhy?\n```',
      ),
    ).toBeUndefined();
    expect(
      foldQuestions("The page says:\n\n> Is this ok? Are you sure?"),
    ).toBeUndefined();
    expect(
      foldQuestions(
        'The banner reads "Are you sure? Really?" and `a?` then: is it the 4.x Client?',
      ),
    ).toBeUndefined();
  });
});
