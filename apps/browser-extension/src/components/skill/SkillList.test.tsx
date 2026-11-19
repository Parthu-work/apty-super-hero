import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillList } from "./SkillList";
import type { SkillClient, SkillMetadata } from "./types";

const downloadBlob = vi.hoisted(() => vi.fn(() => true));
vi.mock("@apty/ui/lib/download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@apty/ui/lib/download")>()),
  downloadBlob,
}));

const SKILL: SkillMetadata = {
  id: "fixture-skill",
  name: "fixture-skill",
  description: "A FIXTURE skill",
  version: "1.0.0",
  uploadedAt: 0,
  enabled: true,
};

function client(overrides: Partial<SkillClient> = {}): SkillClient {
  return {
    initialize: vi.fn(async () => {}),
    isInitialized: () => true,
    listSkills: () => [SKILL],
    exportSkill: vi.fn(async () => new Blob(["zip"])),
    ...overrides,
  } as unknown as SkillClient;
}

describe("SkillList export (KB-RAG K28, F7)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    downloadBlob.mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it("downloads the skill as one ZIP named after it", async () => {
    const skills = client();
    render(<SkillList skillClient={skills} onSkillUpdate={() => {}} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Export fixture-skill" }),
    );
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(skills.exportSkill).toHaveBeenCalledWith("fixture-skill");
    expect(downloadBlob).toHaveBeenCalledWith(
      "fixture-skill.zip",
      expect.any(Blob),
    );
  });

  it("says so when the export fails", async () => {
    const skills = client({
      exportSkill: vi.fn(async () => {
        throw new Error("disk");
      }),
    });
    render(<SkillList skillClient={skills} onSkillUpdate={() => {}} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Export fixture-skill" }),
    );
    expect(
      await screen.findByText('Could not export "fixture-skill".'),
    ).toBeInTheDocument();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
