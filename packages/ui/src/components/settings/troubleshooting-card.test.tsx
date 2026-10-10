import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseThresholdOverrides,
  TroubleshootingCard,
} from "./troubleshooting-card";

afterEach(() => {
  vi.useRealTimers();
});

describe("TroubleshootingCard", () => {
  it("saves DOM Health's extra ignored content as trimmed, non-empty lines once typing pauses", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <TroubleshootingCard
        settings={{ domHealthIgnoredRoots: ["id:acme-"] }}
        onChange={onChange}
      />,
    );
    const field = screen.getByLabelText("DOM Health: content to leave out");
    expect(field).toHaveValue("id:acme-");

    fireEvent.change(field, {
      target: { value: "id:acme-\n\n  tag:support-widget \n" },
    });
    vi.advanceTimersByTime(500);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      domHealthIgnoredRoots: ["id:acme-", "tag:support-widget"],
    });
  });

  it("has the page script switch on by default and saves it when turned off", () => {
    const onChange = vi.fn();
    render(<TroubleshootingCard settings={{}} onChange={onChange} />);

    const toggle = screen.getByRole("switch", {
      name: "Track client-side routing and capture console output from page load",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith({ pageHooksEnabled: false });
  });

  it("saves the sites where the page script never runs, and hides the list while it is off", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { rerender } = render(
      <TroubleshootingCard settings={{}} onChange={onChange} />,
    );

    fireEvent.change(
      screen.getByLabelText("Sites where that script never runs"),
      {
        target: {
          value: " bank.example.com \n\nhttps://*.example.org/admin/*",
        },
      },
    );
    vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledWith({
      pageHooksExcludedSites: [
        "bank.example.com",
        "https://*.example.org/admin/*",
      ],
    });

    rerender(
      <TroubleshootingCard
        settings={{ pageHooksEnabled: false }}
        onChange={onChange}
      />,
    );
    expect(
      screen.queryByLabelText("Sites where that script never runs"),
    ).toBeNull();
  });

  it("shows the threshold overrides only with developer tools on, and saves valid JSON on blur", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TroubleshootingCard settings={{}} onChange={onChange} />,
    );
    expect(
      screen.queryByLabelText("DOM Health: threshold overrides (JSON)"),
    ).toBeNull();

    rerender(
      <TroubleshootingCard
        settings={{
          developerTools: true,
          domHealthThresholdOverrides: { maxUnreadableFrameShare: 0.3 },
        }}
        onChange={onChange}
      />,
    );
    const field = screen.getByLabelText(
      "DOM Health: threshold overrides (JSON)",
    );
    expect(JSON.parse((field as HTMLTextAreaElement).value)).toEqual({
      maxUnreadableFrameShare: 0.3,
    });

    fireEvent.change(field, {
      target: { value: '{"collectorTimeBudgetMs": 9000}' },
    });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith({
      domHealthThresholdOverrides: { collectorTimeBudgetMs: 9000 },
    });
  });

  it("refuses to save overrides that are not a JSON object of numbers", () => {
    const onChange = vi.fn();
    render(
      <TroubleshootingCard
        settings={{ developerTools: true }}
        onChange={onChange}
      />,
    );
    const field = screen.getByLabelText(
      "DOM Health: threshold overrides (JSON)",
    );
    fireEvent.change(field, { target: { value: '{"a": "1"' } });
    fireEvent.blur(field);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Not saved");
    expect(field).toHaveAttribute("aria-invalid", "true");
  });
});

describe("parseThresholdOverrides", () => {
  it.each([
    ["", {}],
    ["  ", {}],
    ['{"a": 1, "b": 0.5}', { a: 1, b: 0.5 }],
    ['{"a": "1"}', null],
    ["[1]", null],
    ["null", null],
    ["1", null],
    ["{", null],
  ])("%j → %j", (text, expected) => {
    expect(parseThresholdOverrides(text)).toEqual(expected);
  });
});
