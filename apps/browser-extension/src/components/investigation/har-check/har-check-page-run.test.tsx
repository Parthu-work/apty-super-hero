import {
  capture,
  harEntriesOf,
  harOf,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import type { DiagnosisResult } from "@apty/browser-runtime/apty/diagnosis/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HarCheckPage } from "./har-check-page";

const check = vi.hoisted(() => ({
  next: undefined as undefined | (() => Promise<unknown>),
}));

vi.mock(
  "@apty/browser-runtime/apty/diagnosis/har-check",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@apty/browser-runtime/apty/diagnosis/har-check")
      >();
    return {
      ...actual,
      runHarCheck: vi.fn((...args: Parameters<typeof actual.runHarCheck>) =>
        check.next ? check.next() : actual.runHarCheck(...args),
      ),
    };
  },
);

vi.mock("../../shell/tool-page-shell", () => ({
  ToolPageShell: ({
    title,
    children,
    footer,
  }: {
    title: string;
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <section aria-label={title}>
      {children}
      {footer}
    </section>
  ),
}));

function choose(file: File) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const harFile = (name: string) =>
  new File([JSON.stringify(harOf(harEntriesOf(capture())))], name, {
    type: "application/json",
  });

beforeEach(() => {
  check.next = undefined;
  (
    chrome.storage as unknown as { onChanged: { addListener: () => void } }
  ).onChanged = { addListener: vi.fn() };
});

describe("HarCheckPage while a check runs (N13)", () => {
  it("drops a result that arrives after another file was picked", async () => {
    let finish: (result: unknown) => void = () => {};
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    render(<HarCheckPage />);
    choose(harFile("first.har"));
    await screen.findByText(/^first\.har:/);
    check.next = () => done;
    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    choose(harFile("second.har"));
    await screen.findByText(/^second\.har:/);
    const { runHarCheck } = await vi.importActual<
      typeof import("@apty/browser-runtime/apty/diagnosis/har-check")
    >("@apty/browser-runtime/apty/diagnosis/har-check");
    finish(
      (await runHarCheck(harOf(harEntriesOf(capture())), {
        packId: "content-not-visible",
        kind: "workflow",
      })) as DiagnosisResult,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Check" })).toBeEnabled(),
    );
    expect(
      screen.queryByRole("region", {
        name: "Visibility check: every workflow",
      }),
    ).toBeNull();
  });

  it("names a check that fails, and lets the SE try again", async () => {
    render(<HarCheckPage />);
    choose(harFile("customer.har"));
    await screen.findByText(/^customer\.har:/);
    check.next = () => Promise.reject(new Error("bad file"));

    fireEvent.click(screen.getByRole("button", { name: "Check" }));

    expect(
      await screen.findByText("The check could not run on this file."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeEnabled();
  });
});
