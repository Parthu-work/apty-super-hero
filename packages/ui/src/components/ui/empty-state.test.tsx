import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

describe("EmptyState", () => {
  it("titles the empty area with a heading and offers its action", () => {
    render(
      <EmptyState
        icon={<svg />}
        title="Something went wrong"
        description="Reload the panel to try again."
        action={<button type="button">Reload panel</button>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload panel" })).toBeVisible();
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive technology", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
