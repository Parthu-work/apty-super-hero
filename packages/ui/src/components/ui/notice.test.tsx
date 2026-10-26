import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "./notice";

describe("Notice", () => {
  it("announces an error at once", () => {
    render(<Notice tone="error">Couldn't finish.</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't finish.");
  });

  it.each([
    "warning",
    "info",
    "success",
  ] as const)("announces a %s notice politely", (tone) => {
    render(<Notice tone={tone}>Keep this tab open.</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Keep this tab open.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows its title, text and action, with a decorative icon", () => {
    const { container } = render(
      <Notice
        tone="warning"
        title="Not exported yet."
        action={<button type="button">Export</button>}
      >
        Closing the panel loses them.
      </Notice>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not exported yet.Closing the panel loses them.Export",
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
