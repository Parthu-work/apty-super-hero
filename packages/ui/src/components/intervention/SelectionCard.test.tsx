import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonitorCard } from "./MonitorCard";
import { SelectionCard } from "./SelectionCard";

const OPTIONS = [
  { id: "orders", label: "Orders", description: "The orders table" },
  { id: "billing", label: "Billing" },
];

const confirm = () => screen.getByRole("button", { name: "Confirm selection" });

describe("SelectionCard", () => {
  it("asks one question with a radio per option, and confirms the one chosen", () => {
    const onConfirm = vi.fn();
    render(
      <SelectionCard
        status="active"
        question="Which page fails?"
        options={OPTIONS}
        onConfirm={onConfirm}
      />,
    );

    const group = screen.getByRole("group", { name: "Which page fails?" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(confirm()).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Billing/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Orders/ }));
    fireEvent.click(confirm());

    expect(onConfirm).toHaveBeenCalledWith({
      selectedOptions: [OPTIONS[0]],
      otherText: undefined,
    });
  });

  it("takes several answers as checkboxes in multiple mode", () => {
    const onConfirm = vi.fn();
    render(
      <SelectionCard
        status="active"
        question="Which pages fail?"
        options={OPTIONS}
        mode="multiple"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Orders/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Billing/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Billing/ }));
    fireEvent.click(confirm());

    expect(onConfirm).toHaveBeenCalledWith({
      selectedOptions: [OPTIONS[0]],
      otherText: undefined,
    });
  });

  it("confirms Other only once its text is filled in", () => {
    const onConfirm = vi.fn();
    render(
      <SelectionCard
        status="active"
        question="Which page fails?"
        options={OPTIONS}
        allowOther
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /^Other/ }));
    expect(confirm()).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Other" }), {
      target: { value: "  Settings  " },
    });
    fireEvent.click(confirm());

    expect(onConfirm).toHaveBeenCalledWith({
      selectedOptions: [],
      otherText: "Settings",
    });
  });

  it("offers Cancel while it waits and not after, and says its status in words", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <SelectionCard
        status="active"
        question="Which page fails?"
        options={OPTIONS}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <SelectionCard
        status="completed"
        options={OPTIONS}
        selectedResult={{ selectedOptions: [OPTIONS[1]!] }}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Billing");
  });
});

describe("MonitorCard", () => {
  it("asks for the click while active and reports a timeout as a warning", () => {
    const { rerender } = render(<MonitorCard status="active" timeout={30} />);
    expect(
      screen.getByRole("region", { name: "Monitor operation" }),
    ).toHaveTextContent(/30/);

    rerender(<MonitorCard status="timeout" />);
    expect(screen.queryByText(/30/)).toBeNull();
    expect(screen.getByRole("status").closest("[data-tone]")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });
});
