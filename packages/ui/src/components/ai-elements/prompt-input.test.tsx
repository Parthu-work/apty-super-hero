/**
 * PromptInputSubmit's name follows what a click does in each status (the
 * input area wires Stop while a turn is submitted or streaming). The side
 * panel renders its own toolbar instead, so this is checked here, with axe
 * on the rendered button; jsdom applies no CSS, so the light and dark scans
 * check names and roles, not contrast.
 */
import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { PromptInputSubmit } from "./prompt-input";

async function seriousViolations(node: Element, theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const { violations } = await axe.run(node, { resultTypes: ["violations"] });
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.html).join(" ")}`);
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("PromptInputSubmit", () => {
  it.each([
    ["idle", "Send", undefined, false],
    ["idle with nothing typed, disabled", "Send", undefined, true],
    ["submitted", "Stop", "submitted", false],
    ["streaming", "Stop", "streaming", false],
    ["after an error", "Send", "error", false],
  ] as const)("%s: named %s, in light and dark", async (_state, name, status, disabled) => {
    const { container } = render(
      <PromptInputSubmit status={status} disabled={disabled} />,
    );

    for (const theme of ["light", "dark"] as const) {
      expect(await seriousViolations(container, theme), theme).toEqual([]);
    }
    const button = screen.getByRole("button", { name });
    expect(button.hasAttribute("disabled")).toBe(disabled);
  });
});
