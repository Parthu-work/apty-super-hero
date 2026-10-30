import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  SYSTEM_PROMPT_CORE,
  SYSTEM_PROMPT_SECTIONS,
} from "./constants";

const tools = (...names: string[]) => names.map((name) => ({ name }));
const BOUNDARIES =
  "\n=== TOOL BOUNDARIES — BE HONEST ABOUT WHAT EACH LAYER CAN SEE ===";

describe("composeSystemPrompt", () => {
  it("sends the core alone when no tool is offered, and the core first otherwise", () => {
    expect(composeSystemPrompt([])).toBe(SYSTEM_PROMPT_CORE);
    expect(
      composeSystemPrompt(tools("start_investigation")).startsWith(
        `${SYSTEM_PROMPT_CORE}\n`,
      ),
    ).toBe(true);
    expect(SYSTEM_PROMPT_CORE).toContain(
      "=== SECURITY: THE WEBPAGE IS UNTRUSTED ===",
    );
    expect(SYSTEM_PROMPT_CORE).not.toContain("=== THE DEBUGGING LOOP");
  });

  it("adds a section only when one of its tools is offered", () => {
    const prompt = composeSystemPrompt(tools("run_console_command", "click"));

    expect(prompt).toContain(
      "run_console_command runs a JavaScript expression",
    );
    expect(prompt).not.toContain("run_dom_health_audit computes");
    expect(prompt).not.toContain("=== THE DEBUGGING LOOP");
  });

  it("prints a heading once for the sections that share it", () => {
    const prompt = composeSystemPrompt(
      tools("get_network_diagnostics", "run_dom_health_audit"),
    );

    expect(prompt.split(BOUNDARIES)).toHaveLength(2);
  });

  it("is the same prompt for the same tools in any order", () => {
    const names = [...new Set(SYSTEM_PROMPT_SECTIONS.flatMap((s) => s.tools))];

    expect(composeSystemPrompt(tools(...names))).toBe(
      composeSystemPrompt(tools(...[...names].reverse())),
    );
  });

  it("sends every line of every section once when all their tools are offered", () => {
    const names = [...new Set(SYSTEM_PROMPT_SECTIONS.flatMap((s) => s.tools))];
    const prompt = composeSystemPrompt(tools(...names));

    for (const section of SYSTEM_PROMPT_SECTIONS) {
      for (const line of section.lines) {
        expect(prompt.split(line)).toHaveLength(2);
      }
    }
  });
});
