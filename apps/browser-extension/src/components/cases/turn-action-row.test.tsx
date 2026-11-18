import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import type { UIMessage } from "@apty/ui/types";
import { describe, expect, it } from "vitest";
import { turnActions } from "./turn-action-row";

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
  it("offers Prepare support bundle for KB cards and for a verdict whose card does not", () => {
    expect(
      turnActions([
        tool("search_kb", { status: "ok", cards: [{ pageId: "101" }] }),
      ]),
    ).toEqual({ supportBundle: true });
    expect(turnActions([tool("run_diagnosis", verdict())])).toEqual({
      supportBundle: true,
    });
  });

  it("never repeats the verdict card's own button, and offers nothing that cannot run", () => {
    expect(
      turnActions([tool("run_diagnosis", verdict("sendSupport"))]),
    ).toEqual({ supportBundle: false });
    expect(
      turnActions([tool("search_kb", { status: "not_covered", cards: [] })]),
    ).toEqual({ supportBundle: false });
    expect(
      turnActions([{ type: "text", text: "FIXTURE model answer" }]),
    ).toEqual({ supportBundle: false });
  });
});
