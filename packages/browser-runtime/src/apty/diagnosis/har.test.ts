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
import { diagnoseContentNotVisible, filesFor } from "./content-not-visible";
import { capture, ENV_PATH, harEntriesOf, harOf } from "./diagnosis-test-utils";
import { evidenceFromHar, pageUrlOfHar } from "./har";
import { diagnoseWidgetNotVisible, WIDGET_FILES } from "./widget-not-visible";

beforeEach(() => {
  settings.value = { redactionMode: "strict", networkBodyCaptureDenyList: [] };
  resetRedactionModeForTests();
});

describe("evidenceFromHar", () => {
  it("gives the packs the same files a connected Client would", async () => {
    const har = harOf(harEntriesOf(capture()));

    const evidence = await evidenceFromHar(har, filesFor("workflow"));

    expect(evidence.envId).toBe("env-0e000000-0000-7000-8000-000000000002");
    expect(
      diagnoseContentNotVisible(evidence, "workflow", "Take a tour").verdict
        .causes[0]?.ruleId,
    ).toBe("CNV-03");
    const widget = diagnoseWidgetNotVisible(
      await evidenceFromHar(har, WIDGET_FILES),
      pageUrlOfHar(har),
    );
    expect(widget.gates.find((g) => g.reason === "envMatch")?.detail).toBe(
      "This page belongs to UAT (order 2).",
    );
  });

  it("reads the newest call of a file, a base64 body, an HTTP error and a call with no response", async () => {
    const files = capture();
    const har = harOf([
      { name: "workflow.json", body: "[]", at: "2026-10-29T09:00:00.000Z" },
      {
        name: "workflow.json",
        body: JSON.stringify(files["workflow.json"]),
        base64: true,
        at: "2026-10-29T11:00:00.000Z",
      },
      { name: "segment.json", body: '{"error":"Forbidden"}', status: 403 },
      { name: "rule.json", status: 0 },
    ]);

    const evidence = await evidenceFromHar(har, [
      "workflow.json",
      "segment.json",
      "rule.json",
      "app-urls.json",
    ]);

    expect(evidence.files["workflow.json"]?.status).toBe("ok");
    expect(evidence.files["workflow.json"]?.json).toEqual(
      files["workflow.json"],
    );
    expect(evidence.files["segment.json"]).toMatchObject({
      status: "http_error",
      httpStatus: 403,
    });
    expect(evidence.files["rule.json"]?.status).toBe("failed");
    expect(evidence.files["app-urls.json"]?.status).toBe("not_observed");
  });

  it("keeps the body deny list and redaction for a HAR's bodies too", async () => {
    settings.value = {
      redactionMode: "strict",
      networkBodyCaptureDenyList: ["/workflow.json"],
    };
    resetRedactionModeForTests();
    const har = harOf([
      { name: "workflow.json", body: "[]" },
      {
        name: "rule.json",
        body: JSON.stringify([
          { id: "r1", name: "Owner", summary: "email is jane.doe@example.com" },
        ]),
      },
    ]);

    const evidence = await evidenceFromHar(har, ["workflow.json", "rule.json"]);

    expect(evidence.files["workflow.json"]).toMatchObject({
      status: "body_denied",
      detail: "/workflow.json",
    });
    expect(JSON.stringify(evidence.files["rule.json"]?.json)).not.toContain(
      "jane.doe@example.com",
    );
  });

  it("keeps a failed call's error text without its URL or token (15)", async () => {
    const har = harOf([{ name: "rule.json", status: 0 }]);
    (har.log.entries[1]?.response as Record<string, unknown>)._error =
      "net::ERR_FAILED https://crm.example.com/patient?mrn=12345 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl";

    const evidence = await evidenceFromHar(har, ["rule.json"]);

    const detail = String(evidence.files["rule.json"]?.detail);
    expect(evidence.files["rule.json"]?.status).toBe("failed");
    expect(detail).toContain("net::ERR_FAILED");
    expect(detail).not.toContain("mrn=12345");
    expect(detail).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("reads a newer 404 of a file, not an older 200 (3)", async () => {
    const files = capture();
    const har = harOf([
      {
        name: "workflow.json",
        body: JSON.stringify(files["workflow.json"]),
        at: "2026-10-29T09:00:00.000Z",
      },
      {
        name: "workflow.json",
        body: '{"error":"Not Found"}',
        status: 404,
        at: "2026-10-29T11:00:00.000Z",
      },
    ]);

    const evidence = await evidenceFromHar(har, ["workflow.json"]);

    expect(evidence.files["workflow.json"]).toMatchObject({
      status: "http_error",
      httpStatus: 404,
    });
  });

  it("reads one environment's files, the newest one's, never a mix (4, N7)", async () => {
    const files = capture();
    const OTHER_ENV = ENV_PATH.replace(
      "env-0e000000-0000-7000-8000-000000000002",
      "env-0e000000-0000-7000-8000-000000000009",
    );
    const har = harOf([
      {
        name: "workflow.json",
        body: JSON.stringify(files["workflow.json"]),
        at: "2026-10-29T09:00:00.000Z",
      },
      {
        name: "segment.json",
        body: JSON.stringify(files["segment.json"]),
        at: "2026-10-29T09:00:01.000Z",
      },
      { name: "workflow.json", body: "[]", at: "2026-10-29T11:00:00.000Z" },
    ]);
    const newest = har.log.entries[3]?.request as { url: string };
    newest.url = newest.url.replace(ENV_PATH, OTHER_ENV);

    const evidence = await evidenceFromHar(har, [
      "workflow.json",
      "segment.json",
    ]);

    expect(evidence.envId).toBe("env-0e000000-0000-7000-8000-000000000009");
    expect(evidence.files["workflow.json"]?.status).toBe("empty");
    expect(evidence.files["segment.json"]?.status).toBe("not_observed");
  });

  it("takes the page the Apty files loaded on, not a sign-in page the HAR starts on (N2)", () => {
    const har = harOf(harEntriesOf(capture()), "https://crm.example.com/leads");
    har.log.entries.unshift({
      _resourceType: "document",
      startedDateTime: "2026-10-29T09:59:00.000Z",
      request: {
        method: "GET",
        url: "https://login.sso.example/authorize?client_id=crm",
      },
      response: { status: 200, content: { mimeType: "text/html" } },
    });

    expect(pageUrlOfHar(har)).toBe("https://crm.example.com/leads");
  });

  it("reads nothing from a file that is not a HAR", async () => {
    const evidence = await evidenceFromHar({ not: "a har" }, ["workflow.json"]);

    expect(evidence.files["workflow.json"]?.status).toBe("not_observed");
    expect(pageUrlOfHar({ not: "a har" })).toBeUndefined();
  });
});
