import { answerLookup } from "@apty/browser-runtime/apty/diagnosis/lookup";
import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(within(ask).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("LookupCard choices and missing files (KB-RAG K28, F2 and F3)", () => {
  const TWO_MANAGERS = {
    ...EVIDENCE,
    files: {
      ...EVIDENCE.files,
      "segment.json": ok("segment.json", [
        { id: "s-2", name: "Managers", isActive: false, workflowIds: [] },
        { id: "s-3", name: "Managers", isActive: true, workflowIds: ["wf-1"] },
      ]),
    },
  };

  it("labels same-named segments apart and answers for the one clicked", () => {
    render(
      <AptyToolDisplay
        tool={tool(
          answerLookup(
            {
              kind: "membership",
              item: "Alpha Ledger Page Tour",
              segment: "Managers",
            },
            TWO_MANAGERS,
          ),
        )}
      />,
    );
    const ask = screen.getByTestId("lookup-ask");
    const choices = within(ask).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual([
      "Managers (s-2, inactive, 0 workflows)",
      "Managers (s-3, active, 1 workflow)",
    ]);
    expect(screen.queryByTestId("lookup-chosen")).toBeNull();
    fireEvent.click(choices[1] as HTMLElement);
    expect(choices[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("lookup-chosen")).toHaveTextContent(
      '"Alpha Ledger Page Tour" is not in the "Managers" segment.',
    );
  });

  it("says the Client has not reported the file, and offers Get the evidence and a reload", () => {
    render(
      <AptyToolDisplay
        tool={tool(
          answerLookup(
            { kind: "show", item: "Alpha Ledger Page" },
            { ...EVIDENCE, files: {} },
          ),
        )}
      />,
    );
    expect(screen.getByTestId("lookup-answer")).toHaveTextContent(
      "The Apty Client has not reported workflow.json yet.",
    );
    const actions = screen.getByTestId("lookup-evidence");
    expect(
      within(actions).getByRole("button", { name: "Get the evidence" }),
    ).toBeInTheDocument();
    expect(
      within(actions).getByRole("button", { name: "Reload the tab" }),
    ).toBeInTheDocument();
  });
});
