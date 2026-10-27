import { describe, expect, it, vi } from "vitest";
import {
  filterSlashGroups,
  type SlashCommandGroup,
  slashQueryAt,
} from "./slash-commands";

describe("slashQueryAt", () => {
  it.each([
    ["/", { position: 0, query: "" }],
    ["/dom", { position: 0, query: "dom" }],
    ["check /sel", { position: 6, query: "sel" }],
    ["line one\n/net", { position: 9, query: "net" }],
  ])("finds the query in %j", (text, expected) => {
    expect(slashQueryAt(text)).toEqual(expected);
  });

  it.each([
    ["a URL", "see https://example.com/a"],
    ["a path", "src/app"],
    ["a second slash", "/dom/"],
    ["a finished word", "/dom health"],
    ["no slash", "hello"],
  ])("ignores %s", (_case, text) => {
    expect(slashQueryAt(text)).toBeNull();
  });
});

describe("filterSlashGroups", () => {
  const command = (id: string, label: string, description?: string) => ({
    id,
    label,
    description,
    onSelect: vi.fn(),
  });
  const groups: SlashCommandGroup[] = [
    {
      id: "tools",
      label: "Tools",
      commands: [
        command("dom-health", "DOM health"),
        command("dom-config", "DOM config"),
        command("network", "Network inspector", "Failed and slow requests"),
      ],
    },
    {
      id: "skills",
      label: "Skills",
      commands: [command("skill-review", "code-review")],
    },
  ];
  const ids = (result: SlashCommandGroup[]) =>
    result.map((group) => [group.id, group.commands.map((c) => c.id)]);

  it("keeps every group for an empty or blank query", () => {
    expect(filterSlashGroups(groups, "")).toEqual(groups);
    expect(filterSlashGroups(groups, "  ")).toEqual(groups);
  });

  it("matches labels case-insensitively and drops groups left empty", () => {
    expect(ids(filterSlashGroups(groups, "DOM"))).toEqual([
      ["tools", ["dom-health", "dom-config"]],
    ]);
  });

  it("matches descriptions", () => {
    expect(ids(filterSlashGroups(groups, "slow"))).toEqual([
      ["tools", ["network"]],
    ]);
  });

  it("matches letters in order, ignoring spaces", () => {
    expect(ids(filterSlashGroups(groups, "dhe"))).toEqual([
      ["tools", ["dom-health"]],
    ]);
    expect(ids(filterSlashGroups(groups, "crev"))).toEqual([
      ["skills", ["skill-review"]],
    ]);
  });

  it("returns nothing when no command matches", () => {
    expect(filterSlashGroups(groups, "zzz")).toEqual([]);
  });
});
