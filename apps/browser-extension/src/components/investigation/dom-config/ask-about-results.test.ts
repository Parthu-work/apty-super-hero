import type { Context } from "@apty/agent-core";
import type { DomConfigApplicationCapture } from "@apty/browser-runtime/apty/dom-config/index";
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

import { buildReportFromCapture } from "@apty/browser-runtime/apty/dom-config/index";
import { createOutboundSanitizer } from "@apty/browser-runtime/runtime/outbound-sanitizer";
import { currentRedactionMode } from "@apty/browser-runtime/runtime/redaction-mode";
import { formatContextsPrivately } from "../../../hooks/outbound-filters";
import { englishTranslate as t } from "../../../services/model-list";
import { domConfigHandoff } from "./ask-about-results";
import { ORIGIN, profile } from "./dom-config-test-fixtures";

const EMAIL = "jane.doe@example.com";
const MRN = "00012345678";
const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYW5lIn0.c2lnbmF0dXJlLXZhbHVlLTEyMw";

function run(
  label: "initial" | "after-reload",
  patient: string,
): DomConfigApplicationCapture["pages"][number]["runs"][number] {
  return {
    meta: {
      label,
      urlShape: `${ORIGIN}/patients/:id?access_token=${TOKEN}`,
      aptyPresent: false,
      extensionNoisePresent: false,
    },
    profile: profile({
      title: { [EMAIL]: 1 },
      "data-mrn": { [`MRN ${MRN}`]: 1 },
      "data-patient": { [patient]: 1 },
      id: { [`ui-id-${label.length}`]: 1, save: 1 },
    }),
  };
}

/** A capture whose page carries a patient's email, record number and name, and a token in its URL. */
const CAPTURE: DomConfigApplicationCapture = {
  applicationName: "app.example.test",
  pages: [
    {
      pageId: `${ORIGIN}/patients/:id`,
      label: `${ORIGIN}/patients/:id`,
      runs: [run("initial", "Jane Doe"), run("after-reload", "John Roe")],
      origin: "crawl",
    },
  ],
};

/** Every rule included: the most the chip can hold. */
const ALL = {
  ruleChoices: {},
  includeReview: true,
  includeRecordSpecific: true,
};

/** What reaches the model: the chip formatted and prepended to the draft, as `AptyAgent` does, then the outbound sanitizer. */
function modelText(contexts: Context[], draft: string): string {
  const input = `${formatContextsPrivately(contexts)}\n\n${draft}`;
  const sanitize = createOutboundSanitizer({ getMode: currentRedactionMode });
  return JSON.stringify(
    sanitize([{ role: "user", content: input }], { tools: [] }),
  );
}

describe("domConfigHandoff", () => {
  const { report } = buildReportFromCapture(CAPTURE);

  it("drafts a question beside one chip holding the Markdown export of the included rules", () => {
    mode.current = "strict";
    const excluded = report.rules[0]!;
    const draft = domConfigHandoff(
      report,
      { ...ALL, ruleChoices: { [excluded.id]: false } },
      t,
    );

    expect(draft.text).toBe(
      "What do these proposed DOM settings mean, and which should we apply first?",
    );
    expect(draft.contexts).toHaveLength(1);
    const chip = draft.contexts?.[0];
    expect(chip).toMatchObject({ type: "custom", label: "DOM config results" });
    expect(chip?.value).toContain("# ");
    const asMarkdown = (rule: typeof excluded) =>
      rule.conditions
        .map((c) => `${c.category} · ${c.operator} · \`${c.value}\``)
        .join(" AND ");
    expect(chip?.value).not.toContain(asMarkdown(excluded));
    expect(chip?.value).toContain(asMarkdown(report.rules[1]!));
  });

  it.each<RedactionMode>([
    "strict",
    "standard",
  ])("never lets the page's email, record number, person names or a token reach the model (%s redaction)", (redaction) => {
    mode.current = redaction;
    const draft = domConfigHandoff(report, ALL, t);

    const sent = modelText(draft.contexts as Context[], draft.text);

    expect(sent).toContain("app.example.test");
    for (const leak of [EMAIL, MRN, TOKEN, "Jane", "John"]) {
      expect(sent).not.toContain(leak);
    }
  });

  it("with redaction off, still sends none of the page's PII-shaped values or names, which the export leaves out", () => {
    mode.current = "off";
    const draft = domConfigHandoff(report, ALL, t);

    const sent = modelText(draft.contexts as Context[], draft.text);

    for (const leak of [EMAIL, MRN, "Jane", "John"]) {
      expect(sent).not.toContain(leak);
    }
  });
});
