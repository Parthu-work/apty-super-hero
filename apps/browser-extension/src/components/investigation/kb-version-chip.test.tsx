import {
  forgetKbVersions,
  rememberKbVersion,
} from "@apty/browser-runtime/kb/kb-version";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { KbVersionChip } from "./kb-version-chip";

beforeEach(() => forgetKbVersions());

describe("KbVersionChip (KB-RAG K27, F7)", () => {
  it("shows the site's version and how it was decided, and follows a change", () => {
    render(<KbVersionChip host="ln.example.com" />);
    expect(screen.queryByTestId("kb-version-chip")).toBeNull();
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
