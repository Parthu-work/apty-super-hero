import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("styles primary exactly like the default variant it replaces", () => {
    render(
      <>
        <Button>Default</Button>
        <Button variant="primary">Primary</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Primary" }).className).toBe(
      screen.getByRole("button", { name: "Default" }).className,
    );
  });

  it("keeps danger and destructive apart: one outlined, one solid", () => {
    render(
      <>
        <Button variant="danger">Stop capture</Button>
        <Button variant="destructive">Delete</Button>
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Stop capture" }).className,
    ).not.toBe(screen.getByRole("button", { name: "Delete" }).className);
  });

  it("does not fire onClick while disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Start capture
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start capture" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("names an icon button by its aria-label", () => {
    render(
      <Button size="icon" aria-label="New chat">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "New chat" })).toBeVisible();
  });

  it("renders its child with button styling when asChild", () => {
    render(
      <Button asChild variant="link">
        <a href="#preflight">Open preflight</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Open preflight" });
    expect(link).toHaveAttribute("data-slot", "button");
  });
});
