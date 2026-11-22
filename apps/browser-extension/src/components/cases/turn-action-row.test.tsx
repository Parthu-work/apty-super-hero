import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import { ChatContext } from "@apty/ui/components/chatbot";
import type { UIMessage } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markFinding = vi.hoisted(() => vi.fn());
vi.mock("../../services/cases", () => ({
  caseRecorder: () => ({ markFinding, current: async () => undefined }),
}));

import { TurnActionRow, turnActions } from "./turn-action-row";

const tool = (toolName: string, output: unknown) =>
  ({
    type: "tool",
    toolName,
    toolCallId: `${toolName}-1`,
    input: {},
    output,
    state: "completed",
  }) as UIMessage["parts"][number];

const verdict = (nextCheck?: string) => {
  const result = diagnoseContentNotVisible(
    evidenceFrom(capture()),
    "workflow",
    "Take a tour",
  );
  return { ...result, verdict: { ...result.verdict, nextCheck } };
};

describe("the turn's action row (KB-RAG K27, E1)", () => {
  it("leaves Prepare support bundle to the ⋯ menu of a KB answer (K29, D2) and of a verdict (K29, D4)", () => {
    expect(
      turnActions([
        tool("search_kb", { status: "ok", cards: [{ pageId: "101" }] }),
      ]).supportBundle,
    ).toBe(false);
    expect(turnActions([tool("run_diagnosis", verdict())]).supportBundle).toBe(
      false,
    );
  });

  it("never repeats the verdict card's own button, and offers nothing that cannot run", () => {
    expect(
      turnActions([tool("run_diagnosis", verdict("sendSupport"))])
        .supportBundle,
    ).toBe(false);
    expect(
      turnActions([tool("search_kb", { status: "not_covered", cards: [] })]),
    ).toEqual({ supportBundle: false, markFinding: false });
    expect(
      turnActions([{ type: "text", text: "FIXTURE model answer" }]),
    ).toEqual({ supportBundle: false, markFinding: false });
  });
});

const KB_FOR_CHECK = {
  status: "ok",
  source: "kb",
  cards: [{ pageId: "1496842241", layer: 1 }],
  results: [{ cite: "kb://1496842241#L1" }],
  runCheck: { packId: "content-not-visible", kind: "workflow" },
};

const kbTool = (output: unknown) =>
  ({
    ...tool("search_kb", output),
    input: { query: "the FIXTURE tour vanished", topK: 3 },
  }) as UIMessage["parts"][number];

function renderRow(parts: UIMessage["parts"], status = "idle") {
  const sendMessage = vi.fn(async () => {});
  render(
    <ChatContext.Provider
      value={{ sessionId: "conv-1", status, sendMessage } as never}
    >
      <TurnActionRow parts={parts} />
    </ChatContext.Provider>,
  );
  return sendMessage;
}

describe("from the card to the check (KB-RAG K27, E5)", () => {
  beforeEach(() => {
    markFinding.mockReset();
    markFinding.mockResolvedValue({});
  });

  it("offers Run the check under a KB card a check pack covers, and runs that check on the SE's question", () => {
    expect(turnActions([kbTool(KB_FOR_CHECK)])).toEqual({
      supportBundle: false,
      runCheck: { packId: "content-not-visible", kind: "workflow" },
      markFinding: false,
    });
    const sendMessage = renderRow([kbTool(KB_FOR_CHECK)]);
    fireEvent.click(screen.getByRole("button", { name: "Run the check" }));
    expect(sendMessage).toHaveBeenCalledWith(
      "the FIXTURE tour vanished",
      undefined,
      undefined,
      { runCheck: { packId: "content-not-visible", kind: "workflow" } },
    );
  });

  it("does not offer Run the check for a card no check reads, and holds it while a turn is running", () => {
    expect(
      turnActions([kbTool({ ...KB_FOR_CHECK, runCheck: undefined })]).runCheck,
    ).toBeUndefined();
    renderRow([kbTool(KB_FOR_CHECK)], "streaming");
    expect(
      screen.getByRole("button", { name: "Run the check" }),
    ).toBeDisabled();
  });

  it("after a confirmed cause, offers a right-or-wrong mark the SE can change until the case closes (the bundle is in the verdict's ⋯ menu)", async () => {
    const found = verdict();
    expect(found.verdict.status).toBe("cause_found");
    expect(turnActions([tool("run_diagnosis", found)])).toEqual({
      supportBundle: false,
      markFinding: true,
    });
    expect(
      turnActions([
        tool("run_diagnosis", {
          ...found,
          verdict: { ...found.verdict, status: "no_cause_in_data", causes: [] },
        }),
      ]).markFinding,
    ).toBe(false);

    renderRow([tool("run_diagnosis", found)]);
    const group = screen.getByRole("group", { name: "Was this cause right?" });
    const wrong = within(group).getByRole("button", { name: "Wrong" });
    fireEvent.click(wrong);
    await screen.findByText(/Marked wrong/);
    expect(wrong).toHaveAttribute("aria-pressed", "true");
    expect(markFinding).toHaveBeenLastCalledWith("conv-1", "no", undefined);
    fireEvent.click(within(group).getByRole("button", { name: "Right" }));
    await screen.findByText(/Marked right/);
    expect(markFinding).toHaveBeenLastCalledWith("conv-1", "yes", undefined);
  });

  it("says when there is no open case to mark", async () => {
    markFinding.mockResolvedValue(undefined);
    renderRow([tool("run_diagnosis", verdict())]);
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    await screen.findByText("No open case to mark.");
    expect(screen.getByRole("button", { name: "Right" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
