import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelChangePrompt } from "./model-change-prompt";

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelChangePrompt", () => {
  it("lists the given models without any network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <ModelChangePrompt
        supportedModels={["gpt-4o"]}
        onModelChange={vi.fn()}
        availableModels={[
          {
            id: "gpt-4o",
            name: "GPT-4o",
            description: "",
            priceLevel: "normal",
          },
        ]}
      />,
    );

    expect(await screen.findByText("GPT-4o")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads models through onFetchModels when given", async () => {
    const onFetchModels = vi
      .fn()
      .mockResolvedValue([
        { id: "gpt-4o", name: "GPT-4o", description: "", priceLevel: "normal" },
      ]);

    render(
      <ModelChangePrompt
        supportedModels={["gpt-4o"]}
        onModelChange={vi.fn()}
        onFetchModels={onFetchModels}
      />,
    );

    await waitFor(() => expect(onFetchModels).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("GPT-4o")).toBeTruthy();
  });
});
