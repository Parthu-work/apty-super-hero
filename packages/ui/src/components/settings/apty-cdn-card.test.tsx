import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AptyCdnCard } from "./apty-cdn-card";

const LABEL =
  "When the Apty Client doesn't answer, read the same public files it reads from Apty's content CDN";

describe("AptyCdnCard", () => {
  it("is on when the setting was never saved, and saves it off", () => {
    const onChange = vi.fn();
    render(<AptyCdnCard settings={{}} onChange={onChange} />);

    const toggle = screen.getByRole("switch", { name: LABEL });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith({ aptyCdnFallback: false });
  });

  it("shows a saved off as off, and names what is read and what is not sent", () => {
    render(
      <AptyCdnCard settings={{ aptyCdnFallback: false }} onChange={vi.fn()} />,
    );

    expect(screen.getByRole("switch", { name: LABEL })).not.toBeChecked();
    expect(screen.getByText(/stored Ask Dapty chat/)).toBeInTheDocument();
    expect(screen.getByText(/No credentials are sent/)).toBeInTheDocument();
  });
});
