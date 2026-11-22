import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const decideKbEgress = vi.hoisted(() => vi.fn());
vi.mock("@apty/browser-runtime/runtime/kb-egress", () => ({
  decideKbEgress,
}));
vi.mock("../../services/cases", () => ({
  caseRecorder: () => ({ current: vi.fn() }),
}));

import { KbAnswerFooter } from "./kb-answer-footer";

describe("a KB answer's source line and where its text goes (K22 S4, K29 D2)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps 'not sent to the AI model' in the (i)", async () => {
    decideKbEgress.mockResolvedValue({
      decision: { allowed: false, reason: "policy-off" },
      packs: [],
    });
    render(<KbAnswerFooter question="FIXTURE question" />);
    await vi.waitFor(() => expect(decideKbEgress).toHaveBeenCalledWith("chat"));
    expect(screen.queryByTestId("kb-egress-sent")).toBeNull();
    expect(
      screen.getByRole("button", { name: "About this source" }),
    ).toHaveAccessibleDescription(
      /Shown here only; not sent to the AI model\./,
    );
  });

  it("shows, outside the (i), that card text also goes to an approved AI model", async () => {
    decideKbEgress.mockResolvedValue({
      decision: { allowed: true, reason: "approved" },
      destination: {
        provider: "azure",
        origin: "https://tenant.example.invalid",
        model: "fixture-model",
      },
      packs: [],
    });
    render(<KbAnswerFooter question="FIXTURE question" />);
    const sent = await screen.findByTestId("kb-egress-sent");
    expect(sent).toBeVisible();
    expect(sent).toHaveTextContent(
      "Also sent to the AI model at https://tenant.example.invalid, fixture-model.",
    );
    const info = screen.getByRole("button", { name: "About this source" });
    fireEvent.click(info);
    expect(info).not.toHaveAccessibleDescription(/not sent to the AI model/);
  });
});
