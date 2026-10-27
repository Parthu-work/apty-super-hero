import type { Context } from "@apty/agent-core";
import type { RedactionMode } from "@apty/debug-contract";
import { describe, expect, it, vi } from "vitest";

const mode = vi.hoisted(() => ({ current: "strict" as RedactionMode }));

vi.mock(
  "@apty/browser-runtime/runtime/redaction-mode",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@apty/browser-runtime/runtime/redaction-mode")
    >()),
    currentRedactionMode: () => mode.current,
  }),
);

// The runtime's entry point opens IndexedDB; the bundle needs only these.
vi.mock("@apty/browser-runtime", async () => ({
  ...(await import("@apty/browser-runtime/apty/validation-bundle")),
  ...(await import("@apty/browser-runtime/apty/dom-health-thresholds")),
}));

import type { DomHealthAuditOutcome } from "@apty/browser-runtime";
import { createOutboundSanitizer } from "@apty/browser-runtime/runtime/outbound-sanitizer";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { formatContextsPrivately } from "../../../hooks/outbound-filters";
import { englishTranslate as t } from "../../../services/model-list";
import { domHealthHandoff } from "./ask-about-result";

const NAME = "Jane Q. Example";
const RECORD = "48151623";
const EMAIL = "jane.example@clinic.test";
const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYW5lLmV4YW1wbGUifQ.c2lnbmF0dXJlLXZhbHVlLTEyMw";
const CHART_URL = `https://ehr.example.test/chart/${RECORD}?patient=${encodeURIComponent(NAME)}&access_token=${TOKEN}`;
const LEAKS = [NAME, "Jane", RECORD, EMAIL, TOKEN, "access_token"];

/** A page result with a patient's name and a token where a real check could pick them up. */
function resultWithPhi(): DomHealthAuditOutcome {
  return {
    available: true,
    auditId: "a1",
    timestamp: Date.now(),
    url: CHART_URL,
    pageTitle: `Chart for ${NAME}`,
    score: 61,
    grade: "FAIR",
    confidence: "MEDIUM",
    evidenceState: "HEALTHY_EVIDENCE",
    confidenceCaps: [],
    summary: `${NAME}'s chart scored 61/100. Session ${TOKEN}.`,
    frameAccessibility: {
      framesTotal: 2,
      framesAccessible: 1,
      framesFailed: 1,
      framesInaccessible: 0,
    },
    frames: [
      {
        frameId: 0,
        parentFrameId: -1,
        key: "top",
        keySource: "top",
        keyStable: true,
        role: "chrome",
        roleReason: "Navigation or status frame.",
        urlTemplate: CHART_URL,
        status: "captured",
      },
      {
        frameId: 3,
        parentFrameId: 0,
        key: `Chart for ${NAME}`,
        keySource: "title",
        keyStable: false,
        role: "application",
        roleReason: "Holds application content.",
        urlTemplate: `https://ehr.example.test/notes?q=${encodeURIComponent(NAME)}`,
        status: "failed",
        error: `No answer for ${EMAIL} (Bearer ${TOKEN})`,
      },
    ],
    coverage: {
      snapshotsCompared: 3,
      elementsAnalyzed: 20,
      interactiveElementsInPage: 20,
      analysis: {
        candidatesFound: 20,
        candidatesAnalyzed: 20,
        capped: false,
        capReason: null,
      },
    },
    elementSamples: [{ tagName: "button", text: NAME }],
    risks: [{ id: "r", severity: "high", title: NAME, evidence: TOKEN }],
    duplicateIds: {
      valuesDuplicatedWithinARoot: 0,
      valuesDuplicatedPageWide: 1,
      elementsWithDuplicatedId: 2,
      samples: [{ id: `patient-${RECORD}` }],
    },
    virtualized: {
      containers: 0,
      observedItems: 0,
      declaredTotal: null,
      samples: [],
    },
    performance: {
      timings: { totalMs: 900 },
      longestSliceMs: 40,
      longestStepMs: 200,
      limits: { timeBudgetMs: 6000 },
      partialReasons: [],
    },
  } as unknown as DomHealthAuditOutcome;
}

/** What reaches the model: the chip formatted and prepended to the draft, as `AptyAgent` does, then the outbound sanitizer. */
function modelText(contexts: Context[], draft: string): string {
  const input = `${formatContextsPrivately(contexts)}\n\n${draft}`;
  const sanitize = createOutboundSanitizer({ getMode: currentRedactionMode });
  return JSON.stringify(
    sanitize([{ role: "user", content: input }], { tools: [] }),
  );
}

describe("domHealthHandoff", () => {
  it("drafts a question beside one removable chip holding the validation bundle", () => {
    const draft = domHealthHandoff(
      { scope: "page", page: resultWithPhi(), application: null },
      t,
    );

    expect(draft.text).toBe(
      "What does this DOM health result mean, and what should we fix first?",
    );
    expect(draft.contexts).toHaveLength(1);
    const chip = draft.contexts?.[0];
    expect(chip).toMatchObject({ type: "custom", label: "DOM health result" });
    const bundle = JSON.parse(chip?.value ?? "null");
    expect(bundle.schema).toBe("apty-dom-health-validation/1");
    expect(bundle.page).toMatchObject({ score: 61, grade: "FAIR" });
    expect(bundle.application).toBeNull();
  });

  it.each<RedactionMode>([
    "strict",
    "standard",
    "off",
  ])("never lets a patient's name or a token reach the model (%s redaction)", (redaction) => {
    mode.current = redaction;
    const draft = domHealthHandoff(
      { scope: "page", page: resultWithPhi(), application: null },
      t,
    );

    const sent = modelText(draft.contexts as Context[], draft.text);

    expect(sent).toContain("apty-dom-health-validation/1");
    expect(sent).toContain("ehr.example.test");
    for (const leak of LEAKS) {
      expect(sent).not.toContain(leak);
    }
  });
});
