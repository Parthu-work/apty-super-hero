/**
 * The "/" list in the composer: the app's groups, then the skills. Focus
 * stays in the textarea, which points at the highlighted row.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  PromptInput,
  PromptInputTextarea,
  type SkillItem,
  usePromptInputSkills,
} from "./prompt-input";
import type { SlashCommandGroup } from "./slash-commands";

const REVIEW_SKILL: SkillItem = {
  id: "code-review",
  name: "code-review",
  description: "Review a diff",
};

function SkillsProbe({ available }: { available: SkillItem[] }) {
  const skills = usePromptInputSkills();
  const { setAvailableSkills } = skills;
  useEffect(
    () => setAvailableSkills(available),
    [available, setAvailableSkills],
  );
  return (
    <output aria-label="Chosen skills">
      {skills.items.map((item) => item.name).join(",")}
    </output>
  );
}

function setup(initial = "") {
  const openHealth = vi.fn();
  const openConfig = vi.fn();
  const groups: SlashCommandGroup[] = [
    {
      id: "tools",
      label: "Tools",
      commands: [
        { id: "dom-health", label: "DOM health", onSelect: openHealth },
        { id: "dom-config", label: "DOM config", onSelect: openConfig },
      ],
    },
  ];
  const skills = [REVIEW_SKILL];

  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <PromptInput onSubmit={vi.fn()} slashCommands={groups}>
        <SkillsProbe available={skills} />
        <PromptInputTextarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </PromptInput>
    );
  }

  render(<Harness />);
  const textarea = screen.getByRole("textbox");
  const type = (value: string) =>
    fireEvent.change(textarea, { target: { value } });
  return { textarea, type, openHealth, openConfig };
}

// jsdom has no layout, so no scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

const listbox = () =>
  screen.queryByRole("listbox", { name: "Tools, investigations and skills" });
const optionNames = () =>
  within(screen.getByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.textContent);

describe("the / command list", () => {
  it("opens on a / that starts a word, with the app's groups before the skills", () => {
    const { type } = setup();
    type("/");

    const list = listbox();
    expect(list).not.toBeNull();
    expect(within(list as HTMLElement).getAllByRole("group")).toHaveLength(2);
    expect(
      within(list as HTMLElement).getByRole("group", { name: "Tools" }),
    ).toBeInTheDocument();
    expect(
      within(list as HTMLElement).getByRole("group", { name: "Skills" }),
    ).toBeInTheDocument();
    expect(optionNames()).toEqual([
      "DOM health",
      "DOM config",
      "code-reviewReview a diff",
    ]);
  });

  it("stays closed for a slash inside a URL", () => {
    const { type } = setup();
    type("https://example.com/");
    expect(listbox()).toBeNull();
  });

  it("filters as you type and hides groups with no match", () => {
    const { type } = setup();
    type("/dom");
    expect(optionNames()).toEqual(["DOM health", "DOM config"]);
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("moves the highlight with the arrows, wrapping, and runs it on Enter", () => {
    const { textarea, type, openHealth, openConfig } = setup("check ");
    type("check /dom");
    const highlighted = () =>
      document.getElementById(
        textarea.getAttribute("aria-activedescendant") ?? "",
      )?.textContent;

    expect(highlighted()).toBe("DOM health");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(highlighted()).toBe("DOM config");
    expect(screen.getByRole("option", { name: /DOM config/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(highlighted()).toBe("DOM health");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(highlighted()).toBe("DOM config");

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(openConfig).toHaveBeenCalledTimes(1);
    expect(openHealth).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("check ");
    expect(listbox()).toBeNull();
    expect(textarea).not.toHaveAttribute("aria-activedescendant");
  });

  it("closes on Escape and keeps what was typed", () => {
    const { textarea, type, openHealth } = setup();
    type("/dom");
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(listbox()).toBeNull();
    expect(textarea).toHaveValue("/dom");
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(openHealth).not.toHaveBeenCalled();
  });

  it("adds a skill as a tag when one is chosen", () => {
    const { textarea, type } = setup();
    type("/review");
    expect(optionNames()).toEqual(["code-reviewReview a diff"]);

    fireEvent.mouseDown(screen.getByRole("option", { name: /code-review/ }));

    expect(
      screen.getByRole("status", { name: "Chosen skills" }),
    ).toHaveTextContent("code-review");
    expect(textarea).toHaveValue("");
  });
});
