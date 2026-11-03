import { diagnoseContentNotVisible } from "@apty/browser-runtime/apty/diagnosis/content-not-visible";
import { diagnoseDaptyConversation } from "@apty/browser-runtime/apty/diagnosis/dapty-conversation";
import {
  capture,
  evidenceFrom,
} from "@apty/browser-runtime/apty/diagnosis/diagnosis-test-utils";
import { diagnoseElementNotFound } from "@apty/browser-runtime/apty/diagnosis/element-not-found";
import { diagnoseLogsAndErrors } from "@apty/browser-runtime/apty/diagnosis/logs-and-errors";
import { diagnosePageReadiness } from "@apty/browser-runtime/apty/diagnosis/page-readiness";
import type {
  ClientEvidence,
  DiagnosisResult,
} from "@apty/browser-runtime/apty/diagnosis/types";
import { diagnoseWidgetNotVisible } from "@apty/browser-runtime/apty/diagnosis/widget-not-visible";
import { I18nProvider } from "@apty/ui/i18n/context";
import type { UIToolPart } from "@apty/ui/types";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckResultCard } from "./check-result-card";

const tool = (output: unknown): UIToolPart => ({
  type: "tool",
  toolName: "run_diagnosis",
  toolCallId: "call-1",
  input: {},
  output,
  state: "completed",
});

const unreachable: ClientEvidence = {
  connection: {
    ok: false,
    failure: "no_response",
    message: "The Apty Client did not answer the request in time.",
  },
  observedNames: [],
  files: {},
};

/** Segment, environment and item names in the fixture's files. */
const FIXTURE_NAMES =
  /Sales team|New hires|Production|UAT|Take a tour|Create a lead|Email format/g;

/**
 * What may stay in Latin script on a Chinese card: names from the files,
 * file names, rule ids and product names. Anything else of three or more
 * English words in a row is untranslated text.
 */
const ALLOWED =
  /“[^”]*”|"[^"]*"|\([^)]*\)|（[^）]*）|[\w.-]+\.json|\b[A-Z]{3}-\w+\b|Apty Client|Apty|Studio|Admin|HTTP \d+|jQuery|XPath|CSS|URL|KB|Ask Dapty|Dapty|https?:\/\/\S+/g;
const ENGLISH_RUN = /[A-Za-z]{2,}(?:[ ,'-]+[A-Za-z]{2,}){2,}/g;

const twoMatches = async () => ({
  ok: true as const,
  frames: [
    {
      depth: 0,
      sameOriginAsTop: true,
      answered: true,
      test: {
        invalid: false,
        matchCount: 2,
        renderedCount: 2,
        brokenHostIndex: null,
        shadowMatches: 0,
        chosen: { rendered: true, inViewport: true },
      },
    },
  ],
});

async function cards(): Promise<Array<[string, DiagnosisResult]>> {
  const files = evidenceFrom(capture());
  return [
    ["content", diagnoseContentNotVisible(files, "workflow", "Take a tour")],
    ["content scan", diagnoseContentNotVisible(files, "workflow")],
    [
      "content unreachable",
      diagnoseContentNotVisible(unreachable, "workflow", "x"),
    ],
    [
      "language",
      diagnoseContentNotVisible(files, "workflow", "Create a lead", "fr"),
    ],
    ["widget", diagnoseWidgetNotVisible(files, "https://other.example.org/x")],
    [
      "widget open",
      diagnoseWidgetNotVisible(files, "https://uat.crm.example.com/leads"),
    ],
    ["widget unreachable", diagnoseWidgetNotVisible(unreachable, undefined)],
    [
      "logs",
      diagnoseLogsAndErrors({
        connection: { ok: true },
        clientLogs: {
          ok: false,
          failure: "no_response",
          message: "The Apty Client did not answer the logs request.",
        },
        calls: [
          { name: "segment.json", host: "client.apty.example", status: 403 },
        ],
        page: {
          ok: false,
          code: "no_page",
          message: "No web page is open in this tab.",
        },
      }),
    ],
    [
      "logs unreachable",
      diagnoseLogsAndErrors({
        connection: unreachable.connection,
        clientLogs: { ok: true, lines: [] },
        calls: [],
      }),
    ],
    ["page", diagnosePageReadiness(undefined)],
    [
      "selector",
      await diagnoseElementNotFound(
        files,
        { kind: "validation", query: "Email format" },
        twoMatches,
      ),
    ],
    [
      "dapty",
      diagnoseDaptyConversation(
        {
          source: "client",
          connection: { ok: true },
          turns: [],
          calls: 0,
          storedChats: 0,
          suggestionIds: true,
        },
        files,
        undefined,
      ),
    ],
  ];
}

describe("CheckResultCard in Chinese (audit item 10)", () => {
  it("shows no English sentence on any check's card", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    const leftovers: string[] = [];
    for (const [name, result] of await cards()) {
      const { unmount, container } = render(
        <I18nProvider storageAdapter={languageStorage as never}>
          <CheckResultCard tool={tool(result)} />
        </I18nProvider>,
      );
      await screen.findByText(/[一-鿿]/, { selector: "h3" });
      const text = (container.textContent ?? "")
        .replace(ALLOWED, " ")
        .replace(FIXTURE_NAMES, " ");
      for (const run of text.match(ENGLISH_RUN) ?? []) {
        leftovers.push(`${name}: ${run}`);
      }
      unmount();
    }
    expect(leftovers).toEqual([]);
  });

  it("names where a selector's element sits in Chinese on its evidence lines", async () => {
    const languageStorage = {
      load: vi.fn().mockResolvedValue("zh"),
      save: vi.fn(),
      watch: vi.fn(() => () => {}),
    };
    const result = await diagnoseElementNotFound(
      evidenceFrom(capture()),
      { kind: "validation", query: "Email format" },
      twoMatches,
    );
    render(
      <I18nProvider storageAdapter={languageStorage as never}>
        <CheckResultCard tool={tool(result)} />
      </I18nProvider>,
    );

    expect(
      await screen.findByText(
        "禁用元素 1: matches = 2, rendered = 2, frame depth = 0",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Disabled element/)).toBeNull();
  });
});
