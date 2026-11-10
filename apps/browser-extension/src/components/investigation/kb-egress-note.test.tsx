import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const decideKbEgress = vi.hoisted(() => vi.fn());
vi.mock("@apty/browser-runtime/runtime/kb-egress", () => ({
  decideKbEgress,
}));

import { KbEgressNote, KbShownHereOnly } from "./kb-egress-note";

describe("the KB egress note (KB-RAG K22)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("says the excerpt stays in the panel when KB text is withheld", async () => {
    decideKbEgress.mockResolvedValue({
      decision: { allowed: false, reason: "policy-off" },
      packs: [],
    });
    render(<KbEgressNote />);
    expect(screen.getByTestId("kb-egress-note")).toHaveTextContent(
      "Shown here only; not sent to the AI model.",
    );
    await vi.waitFor(() => expect(decideKbEgress).toHaveBeenCalledWith("chat"));
    expect(screen.getByTestId("kb-egress-note")).toHaveTextContent(
      "not sent to the AI model",
    );
  });

  it("names the destination when the policy lets KB text go", async () => {
    decideKbEgress.mockResolvedValue({
      decision: { allowed: true, reason: "approved" },
      destination: {
        provider: "azure",
        origin: "https://tenant.openai.azure.com",
        model: "gpt-5",
      },
      packs: [],
    });
    render(<KbEgressNote />);
    expect(
      await screen.findByText(
        "Also sent to the AI model at https://tenant.openai.azure.com, gpt-5.",
      ),
    ).toBeInTheDocument();
  });

  it("is fixed for text the session never holds", () => {
    render(<KbShownHereOnly />);
    expect(screen.getByTestId("kb-egress-note")).toHaveTextContent(
      "Shown here only; not sent to the AI model.",
    );
    expect(decideKbEgress).not.toHaveBeenCalled();
  });
});
