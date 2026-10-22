import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataHandlingCard } from "./data-handling-card";
import {
  REDACTION_PREVIEW_SAMPLE,
  RedactionModeControl,
} from "./redaction-mode-control";

afterEach(() => {
  vi.restoreAllMocks();
});

const fakePreview = (text: string, mode: string) => `[${mode}] ${text.length}`;

describe("RedactionModeControl", () => {
  it("offers the three modes with the current one selected", () => {
    render(<RedactionModeControl mode="standard" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Strict (recommended)")).not.toBeChecked();
    expect(screen.getByLabelText("Standard")).toBeChecked();
    expect(screen.getByLabelText("Off (development only)")).not.toBeChecked();
    expect(screen.getByLabelText("Standard")).toHaveAccessibleDescription(
      /keeps page titles and paths/,
    );
  });

  it("says what each mode does with values typed into form fields", () => {
    render(<RedactionModeControl mode="strict" onChange={vi.fn()} />);

    expect(
      screen.getByLabelText("Strict (recommended)"),
    ).toHaveAccessibleDescription(/not sent at all/);
    expect(screen.getByLabelText("Standard")).toHaveAccessibleDescription(
      /replaced with \[masked\]/,
    );
    expect(
      screen.getByLabelText("Off (development only)"),
    ).toHaveAccessibleDescription(
      /what you type and form values are sent as they are/,
    );
  });

  it("switches between strict and standard at once", () => {
    const onChange = vi.fn();
    render(<RedactionModeControl mode="strict" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Standard"));

    expect(onChange).toHaveBeenCalledWith("standard");
  });

  it("asks for confirmation before turning redaction off, and says what stays masked", () => {
    const onChange = vi.fn();
    render(<RedactionModeControl mode="strict" onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("Off (development only)"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Password or token values in a tool result can reach your AI provider too. Values that look like tokens, API keys, JWTs, bearer credentials or emails, and credential header lines, are still masked.",
    );
    expect(dialog).not.toHaveTextContent(
      "Structural secret redaction stays on",
    );
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep current mode" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Off (development only)"));
    fireEvent.click(screen.getByRole("button", { name: "Turn redaction off" }));
    expect(onChange).toHaveBeenCalledWith("off");
  });

  it("previews the sample before and after in the chosen mode", () => {
    const preview = vi.fn(fakePreview);
    render(
      <RedactionModeControl
        mode="strict"
        onChange={vi.fn()}
        preview={preview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview Standard" }));

    expect(preview).toHaveBeenCalledWith(REDACTION_PREVIEW_SAMPLE, "standard");
    expect(screen.getByText(/Jane Testpatient/)).toBeTruthy();
    expect(
      screen.getByText(`[standard] ${REDACTION_PREVIEW_SAMPLE.length}`),
    ).toBeTruthy();
  });

  it("hides Preview when the host app supplies no redaction function", () => {
    render(<RedactionModeControl mode="strict" onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull();
  });
});

describe("DataHandlingCard redaction", () => {
  it("defaults to strict and saves a change as redactionMode", () => {
    const onChange = vi.fn();
    render(<DataHandlingCard settings={{}} onChange={onChange} />);

    expect(screen.getByLabelText("Strict (recommended)")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Standard"));

    expect(onChange).toHaveBeenCalledWith({ redactionMode: "standard" });
  });
});
