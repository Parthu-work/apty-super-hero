import { markFinding, newCase } from "@apty/agent-core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const close = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../services/cases", () => ({
  caseRecorder: () => ({ close }),
  caseStore: () => ({}),
}));

import { CloseCaseForm } from "./close-case-form";

const NOW = new Date("2026-11-12T10:00:00.000Z");

describe("closing a case after the finding was marked (KB-RAG K27, E5)", () => {
  it("starts from the SE's mark, and closes with it", async () => {
    const record = markFinding(newCase("conv-1", NOW), "no", NOW);
    render(<CloseCaseForm record={record} onDone={() => {}} />);
    expect(screen.getByRole("radio", { name: "No" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await vi.waitFor(() =>
      expect(close).toHaveBeenCalledWith(
        "conv-1",
        "resolved",
        { findingRight: "no" },
        undefined,
      ),
    );
  });
});
