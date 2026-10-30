import { allBrowserTools } from "@apty/browser-runtime/tools/index";
import { SYSTEM_PROMPT_SECTIONS } from "@apty/ui/components/chatbot/constants";
import { describe, expect, it } from "vitest";

describe("system prompt sections", () => {
  it("are keyed only by tools the registry has, so a rename cannot drop a section unnoticed", () => {
    const registered = new Set(allBrowserTools.map((t) => t.name));
    const unknown = SYSTEM_PROMPT_SECTIONS.flatMap((s) => s.tools).filter(
      (name) => !registered.has(name),
    );

    expect(unknown).toEqual([]);
  });
});
