import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TroubleshootingCard } from "./troubleshooting-card";

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
});
