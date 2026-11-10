/**
 * KB-RAG K22 S5 (D-SEC3): with a non-demo KB pack loaded, the mode the
 * sanitizer runs in is never weaker than Standard, whatever is stored; with
 * the pack gone, the SE's own choice applies again.
 */
import { type AgentInputItem, STORAGE_KEYS } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const packs = vi.hoisted(() => ({ loaded: [] as { site: string }[] }));
vi.mock("../storage/kb-store.js", () => ({
  createKbPackStore: () => ({ info: async () => packs.loaded }),
}));

type ChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;
let listeners: ChangeListener[] = [];

import { resetOrgPolicyForTests } from "./org-policy";
import { createOutboundSanitizer } from "./outbound-sanitizer";
import {
  currentRedactionMode,
  getRedactionMode,
  resetRedactionModeForTests,
} from "./redaction-mode";

/** A personal-data field Standard masks and Off sends as it is. */
const RESULT = JSON.stringify({ username: "jtestpatient", segment: "sales" });

function toolResult(): AgentInputItem[] {
  return [
    {
      type: "function_call_result",
      callId: "c1",
      name: "search_elements",
      status: "completed",
      output: { type: "text", text: RESULT },
    } as AgentInputItem,
  ];
}

async function sent(): Promise<string> {
  const sanitize = createOutboundSanitizer({ getMode: currentRedactionMode });
  return JSON.stringify(await sanitize(toolResult(), { tools: [] }));
}

describe("the redaction floor in the sanitizer (D-SEC3)", () => {
  beforeEach(() => {
    listeners = [];
    vi.stubGlobal("indexedDB", {});
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async () => ({
            [STORAGE_KEYS.SETTINGS]: { redactionMode: "off" },
          }),
        },
        managed: { get: async () => ({}) },
        onChanged: {
          addListener: (l: ChangeListener) => listeners.push(l),
          removeListener: (l: ChangeListener) => {
            listeners = listeners.filter((x) => x !== l);
          },
        },
      },
    });
    resetOrgPolicyForTests();
    resetRedactionModeForTests();
  });

  afterEach(() => {
    resetOrgPolicyForTests();
    vi.unstubAllGlobals();
  });

  it("runs as Standard with stored Off while a non-demo pack is loaded, and as Off once it is gone", async () => {
    packs.loaded = [{ site: "synthetic.atlassian.example" }];
    expect(await getRedactionMode()).toBe("standard");
    expect(await sent()).not.toContain("jtestpatient");

    packs.loaded = [];
    for (const l of listeners) {
      l({ apty_kb_packs_changed: { newValue: Date.now() } }, "local");
    }
    await vi.waitFor(() => expect(currentRedactionMode()).toBe("off"));
    expect(await sent()).toContain("jtestpatient");
  });

  it("keeps Off with only a demo pack loaded", async () => {
    packs.loaded = [{ site: "demo.atlassian.invalid" }];
    expect(await getRedactionMode()).toBe("off");
  });
});
