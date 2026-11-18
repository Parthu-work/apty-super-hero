import { newCase, withTurn } from "@apty/agent-core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ kind: "none" as string }));
const data = vi.hoisted(() => ({
  feedback: [
    { at: "2026-11-12T10:00:00.000Z", caseId: "CASE-20261112-0000" },
  ] as Array<Record<string, unknown>>,
  cases: [] as unknown[],
}));

vi.mock("../../services/cases", () => ({
  caseStore: () => ({
    feedback: async () => data.feedback,
    list: async () => data.cases,
    clearFeedback: async () => undefined,
  }),
}));
vi.mock("../../services/kb-cards", () => ({
  loadKbCatalog: async () => ({
    cards: [],
    text: (pageId: string) =>
      pageId === "4002" ? "FIXTURE tooltip opens twice" : undefined,
  }),
}));
vi.mock("@apty/browser-runtime/runtime/org-policy", () => ({
  loadOrgPolicy: async () => ({ kind: policy.kind }),
}));

import { FeedbackCard } from "./feedback-card";

beforeEach(() => {
  policy.kind = "none";
});

describe("FeedbackCard's Clear (K25 audit, G2; D-CASE1)", () => {
  it("is locked while an organization policy is set", async () => {
    policy.kind = "active";
    render(<FeedbackCard />);
    await screen.findByText(/1/, { selector: "[data-testid=feedback-count]" });
    expect(await screen.findByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("is locked when the policy cannot be read", async () => {
    policy.kind = "invalid";
    render(<FeedbackCard />);
    await screen.findByText(/1/, { selector: "[data-testid=feedback-count]" });
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  it("is open with no policy", async () => {
    render(<FeedbackCard />);
    await screen.findByText(/1/, { selector: "[data-testid=feedback-count]" });
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled(),
    );
  });
});

describe("the pilot measures (KB-RAG K27, R4)", () => {
  it("shows counts by version and the median time, and exports them with no question text", async () => {
    const start = newCase("conv", new Date("2026-11-12T10:00:00.000Z"));
    const answered = withTurn(start, {
      at: "2026-11-12T10:01:30.000Z",
      decision: {
        route: "kb",
        version: "4.x",
        versionSource: "files",
        packs: [],
      },
    });
    data.cases = [{ ...answered, outcome: "resolved" }];
    data.feedback = [
      {
        at: "2026-11-12T10:02:00.000Z",
        aptyVersion: "4.x",
        rightCardId: "4002",
        question: "FIXTURE secret question",
      },
    ];
    render(<FeedbackCard />);
    const table = await screen.findByTestId("pilot-measures");
    const row = within(table).getByRole("row", { name: /^4\.x/ });
    expect(row).toHaveTextContent("90 s");
    fireEvent.click(
      screen.getByRole("button", { name: "Export pilot measures (CSV)" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("4.x,1,1,0,0,1,1,0,90");
    expect(dialog).not.toHaveTextContent("FIXTURE secret question");
  });
});

describe("proposed synonyms (KB-RAG K27, E7)", () => {
  const wrong = {
    at: "2026-11-12T10:02:00.000Z",
    mark: "wrong_card",
    aptyVersion: "4.x",
    shownCardId: "4001",
    rightCardId: "4002",
    question: "the FIXTURE hint bubble opens twice",
  };

  it("needs the questions included, and then lists the words the right card lacks as proposals only", async () => {
    data.feedback = [wrong];
    render(<FeedbackCard />);
    await screen.findByText(/1/, { selector: "[data-testid=feedback-count]" });
    const exportButton = screen.getByRole("button", {
      name: "Export proposed synonyms",
    });
    expect(exportButton).toBeDisabled();
    expect(
      screen.getByText(/tick Include my question to export them/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Include my question"));
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    const dialog = await screen.findByRole("dialog");
    const proposals = JSON.parse(
      within(dialog).getByRole("region", { name: "Proposed synonyms" })
        .textContent ?? "",
    );
    expect(proposals).toEqual({
      kind: "apty-kb-synonym-proposals",
      note: "Proposals only. The KB owner decides; nothing here is applied to a pack.",
      proposals: [
        {
          cardId: "4002",
          aptyVersion: "4.x",
          words: [
            { word: "bubble", count: 1 },
            { word: "hint", count: 1 },
          ],
        },
      ],
    });
    expect(dialog).not.toHaveTextContent("opens twice");
  });
});
