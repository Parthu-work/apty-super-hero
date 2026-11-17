import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonTree } from "./json-tree";

describe("JsonTree's first render (KB-RAG K27, U1)", () => {
  it("opens only the root and shows at most 200 nodes, with Show more for the rest", () => {
    const value = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [
        `key${i}`,
        { nested: Array.from({ length: 50 }, (_, j) => j) },
      ]),
    );
    const { container } = render(<JsonTree value={value} />);
    const rows = container.querySelectorAll("button, div.pl-4");
    expect(rows.length).toBeLessThanOrEqual(200);
    expect(screen.getAllByRole("button", { expanded: false }).length).toBe(100);
    const more = screen.getByRole("button", { name: /more/i });
    fireEvent.click(more);
    expect(screen.getAllByRole("button", { expanded: false }).length).toBe(200);
  });
});
