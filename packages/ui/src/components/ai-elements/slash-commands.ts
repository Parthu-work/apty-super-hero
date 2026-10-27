import type { ReactNode } from "react";

/** One row of the "/" list: a tool, an investigation or a skill. */
export interface SlashCommand {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface SlashCommandGroup {
  id: string;
  label: string;
  commands: SlashCommand[];
}

/** The "/query" being typed, when the cursor follows a "/" that starts a word. */
export function slashQueryAt(
  text: string,
): { position: number; query: string } | null {
  const match = text.match(/(^|\s)\/([^\s/]*)$/);
  if (!match) return null;
  const query = match[2] ?? "";
  return { position: text.length - query.length - 1, query };
}

function inOrder(haystack: string, needle: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at++;
    if (at === needle.length) return true;
  }
  return needle.length === 0;
}

function matches(command: SlashCommand, query: string): boolean {
  const label = command.label.toLowerCase();
  return (
    label.includes(query) ||
    (command.description?.toLowerCase().includes(query) ?? false) ||
    inOrder(label.replace(/\s+/g, ""), query.replace(/\s+/g, ""))
  );
}

/** The groups whose commands match `query`, empty groups left out. */
export function filterSlashGroups(
  groups: readonly SlashCommandGroup[],
  query: string,
): SlashCommandGroup[] {
  const needle = query.trim().toLowerCase();
  return groups
    .map((group) => ({
      ...group,
      commands: needle
        ? group.commands.filter((command) => matches(command, needle))
        : group.commands,
    }))
    .filter((group) => group.commands.length > 0);
}
