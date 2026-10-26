import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListRow, ListRowStatic } from "./list-row";

describe("ListRow", () => {
  it("is a button named by its label, description and trailing status", () => {
    const onClick = vi.fn();
    render(
      <ListRow
        label="Settings"
        description="Whole application · Safe link discovery"
        trailing={<span>Not checked</span>}
        chevron
        onClick={onClick}
      />,
    );
    const row = screen.getByRole("button", { name: /^Settings/ });
    expect(row).toHaveTextContent(
      "SettingsWhole application · Safe link discoveryNot checked",
    );
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks the current page for assistive technology", () => {
    render(<ListRow label="DOM health" aria-current="page" />);
    expect(screen.getByRole("button", { name: "DOM health" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows a row that only displays something as plain content", () => {
    render(<ListRowStatic label="/docs/files" trailing="2 of 2 runs" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("2 of 2 runs")).toBeVisible();
  });
});
