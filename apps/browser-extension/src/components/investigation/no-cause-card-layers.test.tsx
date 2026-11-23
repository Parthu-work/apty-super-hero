import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import { diagnoseWidgetNotVisible } from "@apty/browser-runtime/apty/diagnosis/widget-not-visible";
import type { UIToolPart } from "@apty/ui/types";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime/kb/kb-index", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sharedKbIndexSource: () => ({
    current: async () => ({
      card: () => ({ pageId: "1496842241", title: "FIXTURE card title" }),
      cardChunks: () =>
        [1, 2, 3, 4].map((layer) => ({
          id: `x#L${layer}`,
          pageId: "1496842241",
          layer,
          heading: "",
          text: `FIXTURE layer ${layer}`,
          notVerified: false,
        })),
      info: { packs: [] },
    }),
  }),
}));

import { CheckResultCard } from "./check-result-card";

function noCause() {
  const result = diagnoseContentNotVisible(
    evidenceFrom(capture()),
    "workflow",
    "Take a tour",
  );
  return {
    ...result,
    verdict: { ...result.verdict, status: "no_cause_in_data", causes: [] },
  };
}

const tool = (output: unknown): UIToolPart => ({
  type: "tool",
  toolName: "run_diagnosis",
  toolCallId: "call-1",
  input: { kind: "workflow" },
  output,
  state: "completed",
});

describe("a check with no cause (KB-RAG K27, F8)", () => {
  it("shows the card's title and its layers 1 and 2, and says what is likely", async () => {
    render(<CheckResultCard tool={tool(noCause())} />);
    const card = await screen.findByTestId("no-cause-card");
    expect(within(card).getByText("FIXTURE card title")).toBeInTheDocument();
    expect(within(card).getByText("FIXTURE layer 1")).toBeInTheDocument();
    expect(within(card).getByText("FIXTURE layer 2")).toBeInTheDocument();
    expect(within(card).queryByText("FIXTURE layer 4")).toBeNull();
    expect(
      screen.getByText(
        /The rules read these files correctly; no cause found in them\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Confidence: likely/)).toBeNull();
  });
});

describe("a check with no data (KB-RAG K29, B5)", () => {
  it("shows the card's Settings and Console steps, not only its link", async () => {
    const result = diagnoseWidgetNotVisible(
      {
        connection: { ok: true },
        observedNames: [],
        files: {},
      },
      "https://crm.example.com/leads",
    );
    expect(result.verdict.status).toBe("no_data");
    render(<CheckResultCard tool={tool(result)} />);
    const card = await screen.findByTestId("no-cause-card");
    expect(within(card).getByText("FIXTURE layer 1")).toBeInTheDocument();
    expect(within(card).getByText("FIXTURE layer 2")).toBeInTheDocument();
    expect(within(card).queryByText("FIXTURE layer 3")).toBeNull();
  });
});
