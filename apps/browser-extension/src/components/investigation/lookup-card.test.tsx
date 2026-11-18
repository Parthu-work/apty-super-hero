import { answerLookup } from "@apty/browser-runtime/apty/diagnosis/lookup";
import type { UIToolPart } from "@apty/ui/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AptyToolDisplay } from "./apty-tool-display";

const ok = (name: string, json: unknown) => ({
  name,
  status: "ok" as const,
  json,
});
const EVIDENCE = {
  connection: { ok: true as const },
  observedNames: ["workflow.json", "segment.json"],
  files: {
    "workflow.json": ok("workflow.json", [
      { sourceId: "wf-1", name: "Alpha Ledger Page" },
      { sourceId: "wf-2", name: "Alpha Ledger Page Tour" },
    ]),
    "segment.json": ok("segment.json", [
      { id: "s-1", name: "All Users", isActive: true, workflowIds: ["wf-1"] },
    ]),
  },
};

const tool = (output: unknown): UIToolPart => ({
  type: "tool",
  toolName: "lookup_content",
  toolCallId: "call-1",
  input: {},
  output,
  state: "completed",
});

describe("LookupCard (KB-RAG K27, E4)", () => {
  it("answers in one line and a table, in the panel's words, and names the files' source", () => {
    render(
      <AptyToolDisplay
        tool={tool(
          answerLookup(
            {
              kind: "membership",
              item: "alpha ledger page",
              segment: "all-users",
            },
            EVIDENCE,
          ),
        )}
      />,
    );
    const card = screen.getByTestId("lookup-card");
    expect(within(card).getByTestId("lookup-answer")).toHaveTextContent(
      '"Alpha Ledger Page" is in the "All Users" segment.',
    );
    const row = within(card).getAllByRole("row")[1] as HTMLElement;
    expect(row).toHaveTextContent("Alpha Ledger PageAll Usersyesyes");
    expect(
      within(card).getByRole("columnheader", { name: "Listed in the segment" }),
    ).toBeInTheDocument();
    expect(card).toHaveTextContent(
      "Apty 5.x files (workflow.json, segment.json), from the Apty Client's record. No AI model was asked.",
    );
  });

  it("asks one question when two workflows match", () => {
    render(
      <AptyToolDisplay
        tool={tool(
          answerLookup({ kind: "show", item: "Alpha Ledger" }, EVIDENCE),
        )}
      />,
    );
    const ask = screen.getByTestId("lookup-ask");
    expect(ask).toHaveTextContent("Which workflow do you mean?");
    expect(within(ask).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
