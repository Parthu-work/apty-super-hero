import { newCase } from "@apty/agent-core";
import { describe, expect, it } from "vitest";
import { supportFieldsFor } from "../apty/diagnosis/support-fields.js";
import type { DiagnosisResult } from "../apty/diagnosis/types.js";
import { redactTextStrict } from "../runtime/redaction-mode.js";
import {
  buildSupportBundle,
  SUPPORT_BUNDLE_MAX_BYTES,
  safePageUrl,
} from "./support-bundle.js";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const CHUNK_WORD = "Zorblaxian";
const EMAIL = "jane.doe@customer.example";
const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl";
const USER_ID = "user 4815162342";

const RESULT = {
  packId: "content-not-visible",
  cardPageId: "4001",
  verifiedOn: "from code",
  subject: { kind: "workflow", matched: [] },
  gates: [
    {
      id: "segment",
      status: "fail",
      ruleId: "CNV-03",
      reason: "hiddenFromWidget",
      params: { segmentIds: "41, 42" },
      detail: "",
      evidence: [],
      cardPageId: "4001",
    },
  ],
  verdict: {
    status: "cause_found",
    headline: "FIXTURE",
    causes: [
      {
        ruleId: "CNV-03",
        cardPageId: "4001",
        params: { sourceId: "wf-1001" },
        summary: `KB says turn on ${CHUNK_WORD}`,
        fix: "",
        evidence: [
          `workflows.json: {"sourceId":"wf-1001","owner":"${EMAIL}","token":"${TOKEN}","url":"https://crm.acme-corp.com/leads/4815162342?x=1"}`,
          `segment.json: ${"x".repeat(9000)}`,
        ],
      },
    ],
  },
  confidence: "likely",
  files: [{ name: "workflows.json", status: "ok", httpStatus: 200 }],
  notChecked: [],
} as unknown as DiagnosisResult;

const record = () => ({
  ...newCase("conv", NOW, { tabHost: "crm.acme-corp.com", random: () => 0 }),
  symptom: `my tour is gone, ${EMAIL}`,
  aptyVersion: "4.x" as const,
  versionSource: "files" as const,
  mode: "Extension",
  finding: {
    ruleId: "CNV-03",
    cause: "hiddenFromWidget",
    cardPageId: "4001",
    confidence: "likely",
    verification: "from code, not runtime-verified",
  },
  checks: [
    {
      packId: "content-not-visible",
      at: NOW.toISOString(),
      status: "cause_found",
      ruleIds: ["CNV-03"],
    },
  ],
});

const build = (extra = {}) =>
  buildSupportBundle({
    record: record(),
    result: RESULT,
    consoleErrors: [
      `[Apty] failed for ${EMAIL} at https://crm.acme-corp.com/x/123`,
      USER_ID,
    ],
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.0.0 Safari/537.36",
    extensionVersion: "0.1.0",
    redact: redactTextStrict,
    cardLink: (id) =>
      `https://apty.atlassian.net/wiki/spaces/A4PKH/pages/${id}`,
    ...extra,
  });

describe("supportFieldsFor (KB-RAG K25, L2)", () => {
  it("each rule resolves to structured keys; a rule with no list gets the default", () => {
    expect(supportFieldsFor("CNV-03")).toEqual(
      expect.arrayContaining([
        "aptyVersion",
        "workflowId",
        "segmentIds",
        "fileEntry:workflows.json",
      ]),
    );
    expect(supportFieldsFor("XYZ-01")).toEqual([
      "aptyVersion",
      "mode",
      "environment",
      "browser",
      "pageOrigin",
    ]);
  });
});

describe("buildSupportBundle", () => {
  it("fills each requested field from the case and the check, and marks what is missing with a hint", () => {
    const { bundle, missing } = build();
    expect(bundle).toMatchObject({
      schema: "apty-support-bundle",
      version: 1,
      case: { id: "CASE-20261112-0000", outcome: "open" },
      fields: {
        aptyVersion: "4.x",
        mode: "Extension",
        browser: "Chrome 131",
        pageOrigin: "https://customer-app",
        workflowId: "wf-1001",
        segmentIds: ["41", "42"],
        "statusCode:workflows.json": 200,
      },
      finding: {
        ruleId: "CNV-03",
        cards: [
          {
            pageId: "4001",
            link: "https://apty.atlassian.net/wiki/spaces/A4PKH/pages/4001",
          },
        ],
      },
      statusCodes: { "workflows.json": 200 },
      browser: "Chrome 131",
      extensionVersion: "0.1.0",
    });
    expect(bundle.fields.environment).toEqual({
      missing: true,
      hint: expect.stringMatching(/environment/),
    });
    expect(missing).toContain("environment");
    expect(missing).toContain("clientVersion");
  });

  it("holds no email, token, user id, customer host or KB card text, in the JSON or the text form", () => {
    const { json, markdown } = build();
    for (const text of [json, markdown]) {
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("4815162342");
      expect(text).not.toContain("acme-corp");
      expect(text).not.toContain(CHUNK_WORD);
    }
    expect(json).toContain("https://customer-app/leads/:id");
  });

  it("cuts each file entry to 4 KB and the bundle to 200 KB, trimming file entries first", () => {
    const { bundle } = build();
    for (const { entry } of bundle.fileEntries) {
      expect(new TextEncoder().encode(entry).length).toBeLessThanOrEqual(4096);
    }
    const huge = build({
      consoleErrors: Array.from({ length: 60 }, () => "e".repeat(1000)),
    });
    expect(huge.bundle.consoleErrors).toHaveLength(50);
    const many = {
      ...RESULT,
      verdict: {
        ...RESULT.verdict,
        causes: [
          {
            ...RESULT.verdict.causes[0],
            evidence: Array.from(
              { length: 80 },
              (_, i) => `workflows.json: ${i} ${"y".repeat(5000)}`,
            ),
          },
        ],
      },
    } as unknown as DiagnosisResult;
    const capped = build({ result: many });
    expect(new TextEncoder().encode(capped.json).length).toBeLessThanOrEqual(
      SUPPORT_BUNDLE_MAX_BYTES,
    );
    expect(capped.bundle.fileEntries.length).toBeLessThan(80);
    expect(capped.bundle.consoleErrors.length).toBeGreaterThan(0);
  });

  it("leaves out a file the deny list names, and gives the same output every time", () => {
    const denied = build({ denyList: ["workflows.json"] });
    expect(
      denied.bundle.fileEntries.filter((e) => e.file === "workflows.json"),
    ).toEqual([]);
    expect(build().json).toBe(build().json);
  });

  it("safePageUrl keeps Apty and Atlassian hosts, drops query and fragment, and replaces ids", () => {
    expect(safePageUrl("https://app.apty.io/studio/123/edit?token=x#y")).toBe(
      "https://app.apty.io/studio/:id/edit",
    );
    expect(safePageUrl("https://intranet.example.org/a/0f8e2c1d9a7b")).toBe(
      "https://customer-app/a/:id",
    );
  });
});
