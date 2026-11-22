import {
  forgetKbVersions,
  kbVersionForHost,
  kbVersionQuestioned,
  rememberKbVersion,
} from "@apty/browser-runtime/kb/kb-version";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { KbVersionChip } from "./kb-version-chip";

beforeEach(() => forgetKbVersions());

describe("KbVersionChip (KB-RAG K27, F7)", () => {
  it("shows the site's version and how it was decided, and follows a change", () => {
    render(<KbVersionChip host="ln.example.com" />);
    expect(screen.getByTestId("kb-version-chip")).toHaveTextContent(
      "Apty version?",
    );
    act(() => rememberKbVersion("ln.example.com", "4.x", "client"));
    expect(screen.getByTestId("kb-version-chip")).toHaveTextContent(
      "4.x, from the Client's files",
    );
    act(() => rememberKbVersion("ln.example.com", "5.x", "user"));
    expect(screen.getByTestId("kb-version-chip")).toHaveTextContent(
      "5.x, your choice",
    );
  });
});

describe("the header's version chip changes the version at any time (KB-RAG K29, D3)", () => {
  const openMenu = () => {
    fireEvent.keyDown(screen.getByTestId("kb-version-chip"), { key: "Enter" });
    return screen.getByRole("menu");
  };

  it("sets the site's version as the SE's choice, and Not sure forgets it", () => {
    render(<KbVersionChip host="ln.example.com" />);
    expect(screen.getByTestId("kb-version-chip")).toHaveAccessibleName(
      "Apty version for ln.example.com: not known",
    );
    fireEvent.click(
      within(openMenu()).getByRole("menuitemradio", { name: "5.x" }),
    );
    expect(kbVersionForHost("ln.example.com")).toBe("5.x");
    expect(kbVersionQuestioned("ln.example.com")).toBe(true);
    expect(screen.getByTestId("kb-version-chip")).toHaveTextContent(
      "5.x, your choice",
    );
    const menu = openMenu();
    expect(
      within(menu).getByRole("menuitemradio", { name: "5.x" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      within(menu).getByRole("menuitemradio", { name: "Not sure" }),
    );
    expect(kbVersionForHost("ln.example.com")).toBe("unknown");
  });

  it("says a check's files decided it, and offers no choice the files would override", () => {
    rememberKbVersion("ln.example.com", "4.x", "evidence");
    render(<KbVersionChip host="ln.example.com" />);
    const menu = openMenu();
    expect(menu).toHaveTextContent("4.x, from a check's files");
    for (const item of within(menu).getAllByRole("menuitemradio")) {
      expect(item).toHaveAttribute("aria-disabled", "true");
    }
  });
});
