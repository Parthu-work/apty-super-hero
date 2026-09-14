import type { InvestigationSession } from "@aipexstudio/browser-runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosisCard } from "./diagnosis-card";

function baseInvestigation(
  overrides: Partial<InvestigationSession> = {},
): InvestigationSession {
  return {
    id: "inv-1",
    conversationId: "conv-1",
    tabId: 1,
    startedAt: 0,
    updatedAt: 0,
    status: "analyzing",
    userProblem: "Widget not showing",
    suspectedComponents: [],
    hypotheses: [],
    verificationAttempts: [],
    ...overrides,
  };
}

describe("DiagnosisCard", () => {
  it("shows a plain 'no diagnosis yet' message when none has been recorded", () => {
    render(
      <DiagnosisCard investigation={baseInvestigation()} onVerify={vi.fn()} />,
    );

    expect(screen.getByText(/no diagnosis yet/i)).toBeInTheDocument();
  });

  it("never upgrades a 'likely' diagnosis to look confirmed", () => {
    render(
      <DiagnosisCard
        investigation={baseInvestigation({
          diagnosis: "Widget init request returned HTTP 500",
          confidence: "likely",
        })}
        onVerify={vi.fn()}
      />,
    );

    expect(screen.getByText("LIKELY")).toBeInTheDocument();
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument();
    expect(
      screen.getByText("Widget init request returned HTTP 500"),
    ).toBeInTheDocument();
  });

  it("shows the last verification outcome when one was recorded", () => {
    render(
      <DiagnosisCard
        investigation={baseInvestigation({
          diagnosis: "Widget init request returned HTTP 500",
          confidence: "confirmed",
          verificationAttempts: [
            { id: "v1", timestamp: 1, outcome: "confirmed" },
          ],
        })}
        onVerify={vi.fn()}
      />,
    );

    expect(screen.getByText(/diagnosis confirmed/i)).toBeInTheDocument();
  });

  it("calls onVerify when the verify button is clicked", () => {
    const onVerify = vi.fn();
    render(
      <DiagnosisCard
        investigation={baseInvestigation({
          diagnosis: "Widget init request returned HTTP 500",
          confidence: "possible",
        })}
        onVerify={onVerify}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /verify diagnosis/i }));
    expect(onVerify).toHaveBeenCalledOnce();
  });
});
