import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  aiFieldsLocked,
  LockedAiCard,
  OrgPolicyBanner,
} from "./org-policy-notice";
import type { OrgPolicyView } from "./types";

const view = (
  locked: string[],
  extra: Partial<OrgPolicyView> = {},
): OrgPolicyView => ({
  settings: {
    aiProvider: "azure",
    aiHost: "https://tenant.openai.azure.com/openai/v1",
    aiModel: "gpt-org",
    aiToken: "org-secret-token",
  },
  locked: new Set(locked) as OrgPolicyView["locked"],
  ...extra,
});

describe("OrgPolicyBanner", () => {
  it("names an invalid policy's reason", () => {
    render(
      <OrgPolicyBanner
        policy={view([], { invalidReason: '"x" is not a policy key' })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"x" is not a policy key',
    );
  });

  it("shows nothing for a valid policy or none", () => {
    const { container } = render(<OrgPolicyBanner policy={view([])} />);
    expect(container).toBeEmptyDOMElement();
    render(<OrgPolicyBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("LockedAiCard", () => {
  it("shows each locked field read-only, with no edit control, and never the key", () => {
    render(
      <LockedAiCard
        policy={view([
          "aiProvider",
          "aiHost",
          "aiModel",
          "aiToken",
          "aiWorkspaceId",
        ])}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Set by your organization")).toHaveLength(5);
    expect(screen.getByText("azure")).toHaveAccessibleName("Provider");
    expect(screen.queryByText("org-secret-token")).toBeNull();
    expect(screen.getByText("A key is set")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lets the SE fill and save what the policy does not set", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <LockedAiCard
        policy={view(["aiProvider", "aiHost"], {
          settings: { aiProvider: "azure", aiHost: "https://t.example" },
        })}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("AI Model"), {
      target: { value: "gpt-mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ aiModel: "gpt-mine" });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("is used only when the policy sets an AI field", () => {
    expect(aiFieldsLocked(undefined)).toBe(false);
    expect(aiFieldsLocked(view(["redactionMode"]))).toBe(false);
    expect(aiFieldsLocked(view(["aiModel"]))).toBe(true);
  });
});
