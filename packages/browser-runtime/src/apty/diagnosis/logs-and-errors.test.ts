import { describe, expect, it } from "vitest";
import { diagnoseLogsAndErrors } from "./logs-and-errors";
import type { LogEvidence, LogLine } from "./types";

const CLIENT_HOST = "client.apty.example";

function evidence(change: Partial<LogEvidence> = {}): LogEvidence {
  return {
    connection: { ok: true },
    clientLogs: { ok: true, lines: [] },
    calls: [
      { name: "app-urls.json", host: CLIENT_HOST, status: 200 },
      { name: "workflow.json", host: CLIENT_HOST, status: 200 },
    ],
    page: { ok: true, lines: [], framesRead: 1, framesDisabled: 0 },
    ...change,
  };
}

const pageLines = (lines: LogLine[]): Partial<LogEvidence> => ({
  page: { ok: true, lines, framesRead: 1, framesDisabled: 0 },
});

const gateOf = (
  result: ReturnType<typeof diagnoseLogsAndErrors>,
  reason: string,
) => result.gates.find((g) => g.reason === reason);

describe("logs-and-errors", () => {
  it("names the environment problem the Client's logs report, citing its card", () => {
    const result = diagnoseLogsAndErrors(
      evidence({
        clientLogs: {
          ok: true,
          lines: [
            {
              level: "debug",
              message: "Error registering IoC: No active application found",
            },
            { level: "debug", message: "No active application found" },
          ],
        },
      }),
    );

    expect(result.packId).toBe("logs-and-errors");
    expect(result.verdict.status).toBe("cause_found");
    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "LOG-01",
      cardPageId: "1496645690",
      evidence: ['Apty Client logs: "Error registering IoC" (2×)'],
    });
  });

  it("finds the messages the cards name in the page's console too", () => {
    const fetchError = diagnoseLogsAndErrors(
      evidence(
        pageLines([{ level: "error", message: "Error parsing response" }]),
      ),
    );
    expect(fetchError.verdict.causes[0]).toMatchObject({
      ruleId: "LOG-02",
      cardPageId: "1496253321",
    });

    const injected = diagnoseLogsAndErrors(
      evidence(
        pageLines([
          {
            level: "warn",
            message: "[Apty] No matching version found for the current URL: …",
          },
        ]),
      ),
    );
    expect(injected.verdict.causes[0]).toMatchObject({
      ruleId: "LOG-03",
      cardPageId: "1496678479",
    });
  });

  it("finds a failed content request of the Client, and lists its other failed calls apart", () => {
    const result = diagnoseLogsAndErrors(
      evidence({
        calls: [
          { name: "segment.json", host: CLIENT_HOST, status: 403 },
          {
            name: "workflow.json",
            host: CLIENT_HOST,
            failed: true,
            errorText: "net::ERR_FAILED",
          },
          { name: "theme.css", host: CLIENT_HOST, status: 404 },
        ],
      }),
    );

    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "LOG-05",
      cardPageId: "1496351651",
      evidence: ["segment.json: HTTP 403", "workflow.json: net::ERR_FAILED"],
    });
    expect(gateOf(result, "otherCallsFailed")?.evidence).toEqual([
      "theme.css: HTTP 404",
    ]);
  });

  it("finds a CSP block of Apty's hosts, and leaves other hosts' blocks open", () => {
    const apty = diagnoseLogsAndErrors(
      evidence(
        pageLines([
          {
            level: "error",
            source: "csp-violation",
            message: `CSP violation: script-src-elem blocked https://${CLIENT_HOST}/player.js (effective directive: script-src-elem)`,
          },
        ]),
      ),
    );
    expect(apty.verdict.causes[0]).toMatchObject({
      ruleId: "LOG-04",
      cardPageId: "1496612958",
      params: { count: 1, directives: "script-src-elem" },
    });
    expect(JSON.stringify(apty)).not.toContain("player.js");

    const other = diagnoseLogsAndErrors(
      evidence(
        pageLines([
          {
            level: "error",
            source: "csp-violation",
            message:
              "CSP violation: img-src blocked https://ads.example.net/p.gif (effective directive: img-src)",
          },
        ]),
      ),
    );
    expect(gateOf(other, "cspBlockedOther")?.status).toBe("unknown");
    expect(other.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "readConsoleText",
    });
  });

  it("finds an Apty resource that failed to load in the page", () => {
    const result = diagnoseLogsAndErrors(
      evidence(
        pageLines([
          {
            level: "error",
            source: "resource-error",
            message: `Resource failed to load: <script> https://${CLIENT_HOST}/loader.js`,
          },
        ]),
      ),
    );

    expect(result.verdict.causes[0]).toMatchObject({
      ruleId: "LOG-06",
      cardPageId: "1496678479",
    });
  });

  it("names each source it could not read and does not conclude from the rest", () => {
    const result = diagnoseLogsAndErrors(
      evidence({
        clientLogs: {
          ok: false,
          failure: "no_response",
          message: "The Apty Client received the message but answered nothing.",
        },
        page: undefined,
      }),
    );

    expect(gateOf(result, "logsUnavailable")?.detail).toBe(
      "The Apty Client's logs could not be read: The Apty Client received the message but answered nothing.",
    );
    expect(gateOf(result, "noPageConsole")?.status).toBe("unknown");
    expect(result.verdict).toMatchObject({
      status: "candidates",
      nextCheck: "openAppPage",
    });
  });

  it("answers a suspicion of Apty 404s from the Client's own calls", () => {
    const none = diagnoseLogsAndErrors(evidence(), true);
    expect(gateOf(none, "no404FromApty")).toMatchObject({
      status: "unknown",
      cardPageId: "1496645781",
    });
    expect(none.verdict.nextCheck).toBe("removalTest");

    const some = diagnoseLogsAndErrors(
      evidence({
        calls: [{ name: "users.json", host: CLIENT_HOST, status: 404 }],
      }),
      true,
    );
    expect(gateOf(some, "apty404s")?.evidence).toEqual([
      "users.json: HTTP 404",
    ]);
  });

  it("lists other errors without calling them a cause, and says when everything is clean", () => {
    const errors = diagnoseLogsAndErrors(
      evidence(
        pageLines([
          { level: "error", message: "TypeError: x is undefined" },
          {
            level: "error",
            message:
              "TypeError: x is undefined at https://crm.example.com/app.js",
          },
          { level: "log", message: "ready" },
        ]),
      ),
    );
    expect(gateOf(errors, "errorsLogged")).toMatchObject({
      status: "info",
      evidence: [
        "page console: TypeError: x is undefined",
        "page console: TypeError: x is undefined at [url]",
      ],
    });
    expect(errors.verdict.causes).toEqual([]);

    const clean = diagnoseLogsAndErrors(evidence());
    expect(clean.verdict).toMatchObject({
      status: "no_cause_in_data",
      nextCheck: "sendSupport",
    });
    expect(clean.notChecked).toEqual(["extension-page-console", "cors"]);
  });

  it("reports an unreachable Client as no data", () => {
    const result = diagnoseLogsAndErrors(
      evidence({
        connection: {
          ok: false,
          failure: "no_receiver",
          message: "Nothing listening.",
        },
      }),
    );

    expect(result.verdict).toMatchObject({
      status: "no_data",
      nextCheck: "fixConnection",
    });
  });
});
