import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataHandlingCard } from "./data-handling-card";

afterEach(() => {
  vi.useRealTimers();
});

describe("DataHandlingCard", () => {
  it("shows body capture off, with the deny-list disabled, by default", () => {
    render(<DataHandlingCard settings={{}} onChange={vi.fn()} />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("turns body capture on from the switch", () => {
    const onChange = vi.fn();
    render(<DataHandlingCard settings={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledWith({ networkBodyCaptureEnabled: true });
  });

  it("saves the deny-list as trimmed, non-empty lines once typing pauses", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <DataHandlingCard
        settings={{ networkBodyCaptureEnabled: true }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: " bank.example \n" },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: " bank.example \n\n/api/patients\n" },
    });
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({
      networkBodyCaptureDenyList: ["bank.example", "/api/patients"],
    });
  });

  it("saves a pending deny-list edit when the field loses focus", () => {
    const onChange = vi.fn();
    render(
      <DataHandlingCard
        settings={{ networkBodyCaptureEnabled: true }}
        onChange={onChange}
      />,
    );

    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "bank.example" } });
    fireEvent.blur(box);

    expect(onChange).toHaveBeenCalledWith({
      networkBodyCaptureDenyList: ["bank.example"],
    });
  });
});
