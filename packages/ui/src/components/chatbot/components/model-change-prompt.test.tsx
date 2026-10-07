import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchModelsForPrompt = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/models", () => ({
  fetchModelsForPrompt: mockFetchModelsForPrompt,
}));

import { ModelChangePrompt } from "./model-change-prompt";

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchModelsForPrompt.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ModelChangePrompt — default network behavior", () => {
  it("never calls the built-in third-party fetch when neither onFetchModels nor fetchFromServer is given", async () => {
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

    // Give any stray effect a tick to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockFetchModelsForPrompt).not.toHaveBeenCalled();
  });

  it("calls the built-in fetch only when fetchFromServer is explicitly true", async () => {
    render(
      <ModelChangePrompt
        supportedModels={["gpt-4o"]}
        onModelChange={vi.fn()}
        fetchFromServer
      />,
    );

    await waitFor(() => {
      expect(mockFetchModelsForPrompt).toHaveBeenCalledTimes(1);
    });
  });

  it("prefers onFetchModels over the built-in fetch, even with fetchFromServer true", async () => {
    const onFetchModels = vi.fn().mockResolvedValue([]);

    render(
      <ModelChangePrompt
        supportedModels={["gpt-4o"]}
        onModelChange={vi.fn()}
        onFetchModels={onFetchModels}
        fetchFromServer
      />,
    );

    await waitFor(() => {
      expect(onFetchModels).toHaveBeenCalledTimes(1);
    });
    expect(mockFetchModelsForPrompt).not.toHaveBeenCalled();
  });
});
