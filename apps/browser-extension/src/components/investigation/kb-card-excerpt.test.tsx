import { createHash } from "node:crypto";
import {
  canonicalJson,
  createKbIndex,
  KB_PACK_KIND,
  type KbAptyVersion,
  type KbPack,
} from "@apty/agent-core";
import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import { diagnoseContentNotVisible4x } from "@apty/browser-runtime/apty/diagnosis/content-not-visible-4x";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import type { UIToolPart } from "@apty/ui/types";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("@apty/browser-runtime/kb/kb-index", () => ({
  sharedKbIndexSource: () => source,
}));

import { CheckResultCard } from "./check-result-card";

const CARD = "1496842241";

function pack(
  layer1: string,
  { card = CARD, aptyVersion = "5.x" as KbAptyVersion } = {},
): KbPack {
  const body = {
    kind: KB_PACK_KIND,
    schemaVersion: 1,
    builtAt: "2026-03-01T00:00:00.000Z",
    builder: "build-kb-pack 1.0.0",
    source: {
      site: "fixture.atlassian.net",
      space: "FX",
      label: "rag-card",
      cardCount: 1,
    },
    aptyVersion,
    retrieval: { bm25: true },
    cards: [
      {
        pageId: card,
        title: "FIXTURE workflow not in the widget",
        group: "FIXTURE",
        verifiedOn: "Verified on: FIXTURE code, 2026-01-01.",
        notVerifiedCount: 0,
        url: `https://fixture.atlassian.net/wiki/spaces/FX/pages/${card}`,
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    ],
    chunks: [1, 2, 3, 4].map((layer) => {
      const text = layer === 1 ? layer1 : `- FIXTURE layer ${layer}.`;
      return {
        id: `${card}#L${layer}`,
        pageId: card,
        layer,
        heading: `Layer ${layer}: FIXTURE`,
        text,
        notVerified: text.includes("NOT VERIFIED"),
      };
    }),
  };
  const sha256 = createHash("sha256").update(canonicalJson(body)).digest("hex");
  return { ...body, sha256 } as KbPack;
}

const tool = (
  output: unknown = diagnoseContentNotVisible(
    evidenceFrom(capture()),
    "workflow",
    "Take a tour",
  ),
): UIToolPart => ({
  type: "tool",
  toolName: "run_diagnosis",
  toolCallId: "call-1",
  input: { kind: "workflow" },
  output,
  state: "completed",
});

beforeEach(() => source.current.mockReset());

describe("From the KB card", () => {
  it("shows the cause's settings layer, the Verified on line, and keeps the link", async () => {
    source.current.mockResolvedValue(
      createKbIndex(pack("- FIXTURE: clear the Hide From Widget switch.")),
    );
    render(<CheckResultCard tool={tool()} />);
    const trigger = await screen.findByRole("button", {
      name: "From the KB card",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    const region = trigger.closest("li") as HTMLElement;
    expect(
      within(region).getByText("- FIXTURE: clear the Hide From Widget switch."),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(
        "Layer 1 of “FIXTURE workflow not in the widget”",
      ),
    ).toBeInTheDocument();
    expect(
      within(region).getByText("Verified on: FIXTURE code, 2026-01-01."),
    ).toBeInTheDocument();
    expect(
      within(region).getAllByRole("link", { name: /KB card 1496842241/ }),
    ).not.toHaveLength(0);
    expect(within(region).queryByText("Not verified")).toBeNull();
  });

  it("marks a NOT VERIFIED layer on the expander itself", async () => {
    source.current.mockResolvedValue(
      createKbIndex(pack("- NOT VERIFIED: FIXTURE switch.")),
    );
    render(<CheckResultCard tool={tool()} />);
    const trigger = await screen.findByRole("button", {
      name: /From the KB card/,
    });
    expect(within(trigger).getByText("Not verified")).toBeInTheDocument();
  });

  it("shows only the link with no pack, or a pack without the card", async () => {
    for (const index of [
      null,
      createKbIndex({ ...pack("- x"), cards: [], chunks: [] }),
    ]) {
      source.current.mockResolvedValue(index);
      const { unmount } = render(<CheckResultCard tool={tool()} />);
      await vi.waitFor(() => expect(source.current).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 10));
      expect(
        screen.queryByRole("button", { name: /From the KB card/ }),
      ).toBeNull();
      expect(
        screen.getAllByRole("link", { name: /KB card 1496842241/ }),
      ).not.toHaveLength(0);
      unmount();
      source.current.mockReset();
    }
  });

  it("F3: shows a 4.x cause's own card from a 4.x pack, not the tree root", async () => {
    const hidden = "1509720308";
    source.current.mockResolvedValue(
      createKbIndex(
        pack("- FIXTURE: clear the 4.x hide-in-widget option.", {
          card: hidden,
          aptyVersion: "4.x",
        }),
      ),
    );
    render(
      <CheckResultCard
        tool={tool(
          diagnoseContentNotVisible4x(
            evidenceFrom(capture("content-4x")),
            "workflow",
            "Close a deal",
          ),
        )}
      />,
    );
    const trigger = await screen.findByRole("button", {
      name: "From the KB card",
    });
    fireEvent.click(trigger);
    const region = trigger.closest("li") as HTMLElement;
    expect(within(region).getByText(/C4X-03/)).toBeInTheDocument();
    expect(
      within(region).getByText(
        "- FIXTURE: clear the 4.x hide-in-widget option.",
      ),
    ).toBeInTheDocument();
    expect(
      within(region).getAllByRole("link", {
        name: new RegExp(`KB card ${hidden}`),
      }),
    ).not.toHaveLength(0);
  });
});
