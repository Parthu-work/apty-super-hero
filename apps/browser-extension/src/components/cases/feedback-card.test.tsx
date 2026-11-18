import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ kind: "none" as string }));

vi.mock("../../services/cases", () => ({
  caseStore: () => ({
    feedback: async () => [
      { at: "2026-11-12T10:00:00.000Z", caseId: "CASE-20261112-0000" },
    ],
    clearFeedback: async () => undefined,
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
