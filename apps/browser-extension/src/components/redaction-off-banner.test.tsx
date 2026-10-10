import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockOpenOptions = vi.hoisted(() => vi.fn());
vi.mock("../lib/open-options", () => ({ openOptions: mockOpenOptions }));

import { RedactionOffBanner } from "./redaction-off-banner";

afterEach(() => {
  vi.resetAllMocks();
});

describe("RedactionOffBanner", () => {
  it.each([
    ["strict"],
    ["standard"],
    [undefined],
  ] as const)("is hidden when the mode is %s", (mode) => {
    const { container } = render(<RedactionOffBanner mode={mode} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says redaction is off and links to Data handling", () => {
    render(<RedactionOffBanner mode="off" />);

    expect(screen.getByRole("status").textContent).toMatch(
      /Redaction is OFF.*tokens, keys and emails are still masked/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(mockOpenOptions).toHaveBeenCalledWith({ section: "data-handling" });
  });
});
