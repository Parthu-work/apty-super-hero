import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PacksLine, PackUpdateBanner } from "./pack-freshness-view";

describe("PacksLine (KB-RAG K27, E9)", () => {
  it("names each version's state in one line", () => {
    render(
      <PacksLine
        items={[
          { version: "4.x", state: "ok" },
          { version: "5.x", state: "expires", days: 59 },
          { version: "common", state: "expires", days: 1 },
        ]}
      />,
    );
    expect(screen.getByTestId("kb-packs-line")).toHaveTextContent(
      "Packs: 4.x ok, 5.x expires in 59 days, common expires in 1 day",
    );
  });

  it("says when a pack expired or is not used, and when none is loaded", () => {
    const { rerender } = render(
      <PacksLine
        items={[
          { version: "4.x", state: "expired" },
          { version: "5.x", state: "notUsed", reason: "untrusted" },
        ]}
      />,
    );
    expect(screen.getByTestId("kb-packs-line")).toHaveTextContent(
      "Packs: 4.x expired, 5.x not used",
    );
    rerender(<PacksLine items={[]} />);
    expect(screen.getByTestId("kb-packs-line")).toHaveTextContent(
      "Packs: none loaded",
    );
  });

  it("keeps its place while the packs are read", () => {
    render(<PacksLine items={undefined} />);
    expect(screen.getByTestId("kb-packs-line")).toHaveTextContent("");
  });
});

describe("PackUpdateBanner (KB-RAG K27, E9)", () => {
  it("announces each delivered pack, and Got it and Open Knowledge base act", () => {
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    render(
      <PackUpdateBanner
        delivered={[
          {
            version: "5.x",
            sha256: "b".repeat(64),
            builtAt: "2026-11-17T08:00:00.000Z",
          },
        ]}
        onDismiss={onDismiss}
        onOpen={onOpen}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("New KB pack delivered");
    expect(banner).toHaveTextContent(
      "5.x: built 2026-11-17. New answers use it.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open Knowledge base" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onOpen).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders nothing when no pack was delivered", () => {
    const { container } = render(
      <PackUpdateBanner delivered={[]} onDismiss={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
