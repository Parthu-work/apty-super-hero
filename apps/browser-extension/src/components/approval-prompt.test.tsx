import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageStore: Record<string, unknown> = {};
let runtimeListeners: Array<
  (message: unknown, sender: chrome.runtime.MessageSender) => unknown
> = [];
const mockSendMessage = vi.fn();

(global as any).chrome = {
  runtime: {
    id: "agent-id",
    sendMessage: mockSendMessage,
    onMessage: {
      addListener: (l: (typeof runtimeListeners)[number]) =>
        runtimeListeners.push(l),
      removeListener: (l: (typeof runtimeListeners)[number]) => {
        runtimeListeners = runtimeListeners.filter((x) => x !== l);
      },
    },
  },
  storage: {
    local: {
      get: (key: string) => Promise.resolve({ [key]: storageStore[key] }),
      set: (items: Record<string, unknown>) => {
        storageStore = { ...storageStore, ...items };
        return Promise.resolve();
      },
    },
  },
};

import {
  APPROVAL_DECISION_MESSAGE,
  APPROVAL_REQUEST_MESSAGE,
  gateRiskyAction,
  resetApprovalStateForTests,
} from "@apty/browser-runtime/tools/approval";
import { ApprovalPrompt } from "./approval-prompt";

const remoteRequest = {
  approvalId: "remote-1",
  toolName: "run_console_command",
  summary: "Run this JavaScript: 1 + 1",
  origin: "https://app.example.com",
  createdAt: 0,
};

function deliver(message: unknown, sender: chrome.runtime.MessageSender) {
  act(() => {
    for (const listener of runtimeListeners) listener(message, sender);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  mockSendMessage.mockResolvedValue(undefined);
  await resetApprovalStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ApprovalPrompt", () => {
  it("runs a local tool's action only after Allow is clicked", async () => {
    render(<ApprovalPrompt />);
    const run = vi.fn().mockResolvedValue("done");

    const pending = gateRiskyAction(
      "c",
      "fill_form",
      "Fill 2 fields",
      "https://app.example.com/x",
      run,
    );
    await screen.findByText("Allow fill_form?");
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await expect(pending).resolves.toBe("done");
    await waitFor(() =>
      expect(screen.queryByText("Allow fill_form?")).not.toBeInTheDocument(),
    );
  });

  it("sends the decision for a service-worker request back as a runtime message", async () => {
    render(<ApprovalPrompt />);
    deliver(
      { type: APPROVAL_REQUEST_MESSAGE, request: remoteRequest },
      {
        id: "agent-id",
        url: "chrome-extension://agent-id/service-worker-loader.js",
      },
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Allow on this site for 15 min",
      }),
    );

    expect(mockSendMessage).toHaveBeenCalledWith({
      type: APPROVAL_DECISION_MESSAGE,
      approvalId: "remote-1",
      approved: true,
      remember: true,
    });
    expect(screen.queryByText(/Allow run_console_command/)).toBeNull();
  });

  it("ignores requests injected by a content script", () => {
    render(<ApprovalPrompt />);

    deliver(
      { type: APPROVAL_REQUEST_MESSAGE, request: remoteRequest },
      {
        id: "agent-id",
        tab: { id: 3 } as chrome.tabs.Tab,
        url: "https://app.example.com/",
      },
    );

    expect(screen.queryByText(/Allow run_console_command/)).toBeNull();
  });
});
