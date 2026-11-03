/**
 * The Ask Dapty check on captures from live tenants (W2): every case folder
 * under `fixtures/dapty-live/` holds the SE's redacted HAR and the card they
 * observed (`expected.json`, written by `tooling/scripts/dapty-bundle-to-fixture.mjs`
 * from the evidence bundle). The check must give the same rule ids, gates and
 * suggestion rows on the HAR alone. An empty folder has no cases.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

(globalThis as { chrome?: unknown }).chrome = {
  runtime: { id: "agent" },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: settings.value })),
    },
    onChanged: { addListener: vi.fn() },
  },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { DAPTY_FILES, diagnoseDaptyConversation } from "./dapty-conversation";
import { capture, harEntriesOf, harOf } from "./diagnosis-test-utils";
import { daptyFromHar, evidenceFromHar, pageUrlOfHar } from "./har";
import type { DiagnosisResult } from "./types";

const LIVE = fileURLToPath(new URL("./fixtures/dapty-live", import.meta.url));
const HAR = "capture.har.json";
const EXPECTED = "expected.json";

/** What a case pins down: the converter's `expectedFrom`, from the card the SE saw. */
interface Expected {
  verdict: string;
  ruleIds: string[];
  gates: Array<{ id: string; status: string; reason: string }>;
  suggestions: Array<{ name: string; type?: string; status: string }>;
}

function expectedOf(result: DiagnosisResult): Expected {
  return {
    verdict: result.verdict.status,
    ruleIds: result.verdict.causes.map((c) => c.ruleId),
    gates: result.gates.map(({ id, status, reason }) => ({
      id,
      status,
      reason,
    })),
    suggestions: (result.dapty?.suggestions ?? []).map(
      ({ name, type, status }) => ({ name, ...(type ? { type } : {}), status }),
    ),
  };
}

async function checkHar(har: unknown): Promise<DiagnosisResult> {
  const [chat, files] = await Promise.all([
    daptyFromHar(har),
    evidenceFromHar(har, DAPTY_FILES),
  ]);
  return diagnoseDaptyConversation(chat, files, pageUrlOfHar(har));
}

const cases = existsSync(LIVE)
  ? readdirSync(LIVE).filter((name) => statSync(join(LIVE, name)).isDirectory())
  : [];

const readJson = (dir: string, file: string): unknown =>
  JSON.parse(readFileSync(join(LIVE, dir, file), "utf8"));

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("the Ask Dapty check on live-tenant captures", () => {
  it("has a HAR and the observed card in every case folder", () => {
    for (const name of cases) {
      expect(existsSync(join(LIVE, name, HAR)), `${name}/${HAR}`).toBe(true);
      expect(
        existsSync(join(LIVE, name, EXPECTED)),
        `${name}/${EXPECTED}`,
      ).toBe(true);
    }
  });

  it.each(cases)("%s gives the card the SE observed", async (name) => {
    const result = await checkHar(readJson(name, HAR));

    expect(expectedOf(result)).toEqual(readJson(name, EXPECTED));
  });

  it("compares the rule ids, gates and suggestion rows a case pins down", async () => {
    const har = harOf(
      harEntriesOf(capture()),
      "https://uat.crm.example.com/leads",
    );
    har.log.entries.push({
      startedDateTime: "2026-10-29T10:00:09.000Z",
      request: {
        method: "POST",
        url: "https://api.app.apty.ai/ai-service/api/v1/ai/t-1/widget/chat?applicationId=a-1",
        postData: {
          mimeType: "application/json",
          text: JSON.stringify({ message: "Export?", context: [] }),
        },
      },
      response: {
        status: 200,
        content: {
          mimeType: "application/json",
          text: JSON.stringify({
            reply: "Try this.",
            suggestions: [
              {
                id: "0c000000-0000-7000-8000-0000000000ff",
                name: "Retired flow",
                type: "workflow",
              },
            ],
          }),
        },
      },
    } as (typeof har.log.entries)[number]);

    const expected = expectedOf(await checkHar(har));

    expect(expected).toMatchObject({
      verdict: "cause_found",
      ruleIds: ["DAP-06"],
      suggestions: [
        { name: "Retired flow", type: "workflow", status: "missing" },
      ],
    });
    expect(expected.gates).toContainEqual({
      id: "chat-suggestions",
      status: "fail",
      reason: "suggestionsMissing",
    });
  });
});
