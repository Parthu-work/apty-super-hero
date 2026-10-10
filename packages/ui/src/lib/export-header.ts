import type { RedactionModeSetting } from "@apty/agent-core";

/** First line of a text export: which redaction mode its content went through. */
export function exportHeader(
  mode: RedactionModeSetting | undefined,
  now: Date = new Date(),
): string {
  return `Apty Agent export · redaction mode: ${mode ?? "strict"} · ${now.toISOString()}`;
}

/** `text` with the export header and a blank line in front. */
export function withExportHeader(
  text: string,
  mode: RedactionModeSetting | undefined,
  now?: Date,
): string {
  return `${exportHeader(mode, now)}\n\n${text}`;
}
