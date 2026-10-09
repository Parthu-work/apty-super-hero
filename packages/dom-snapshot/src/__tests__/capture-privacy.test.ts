import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDomHealthRegistryForTests,
  collectDomHealthSnapshot,
} from "../health-collector";
import {
  collectDiscoverableLinks,
  collectSafeNavigationCandidates,
} from "../health-links";
import {
  REDACTED_TEXT,
  REDACTED_VALUE,
  sanitizeAttributeValue,
} from "../health-privacy";
import { computeFrameStateSignature } from "../health-state-signature";

/** Fake values of the shapes found in the athenaOne exports (brief section 2.2). */
const PATIENT = "Jane Q Testpatient";
const DATADOG_TOKEN = `pub${"0".repeat(31)}1`;
const SESSION = "sess-FAKE-0000000000000000";
const PRACTICE_ID = "4242424";

beforeEach(() => {
  __resetDomHealthRegistryForTests();
  document.body.innerHTML = "";
});

/**
 * Everything a frame sends back as evidence. Discovered link URLs are left
 * out: they are navigation targets the service worker must load as they
 * are (a session-scoped link needs its token), and they are redacted on
 * the way out of the service worker (`redactAuditUrl`), never reported raw.
 * Their text is evidence and is checked.
 */
async function capturedBundle(): Promise<string> {
  const snapshot = await collectDomHealthSnapshot(document);
  const signature = computeFrameStateSignature(document);
  return JSON.stringify({
    snapshot,
    signature,
    linkTexts: collectDiscoverableLinks(document).map((link) => link.text),
    candidates: collectSafeNavigationCandidates(document),
  });
}

describe("what a captured DOM Health bundle may contain (D-9)", () => {
  it("never contains an input value, a script body or a query-string token", async () => {
    document.body.innerHTML = `
      <script>window.DD_RUM.init({ clientToken: "${DATADOG_TOKEN}" })</script>
      <style>.x::after { content: "${PATIENT}" }</style>
      <form>
        <input name="firstName" value="${PATIENT}">
        <textarea name="note">${PATIENT}</textarea>
      </form>
      <nav>
        <a href="/patients/${PRACTICE_ID}?session=${SESSION}&tab=chart">Chart<script>"${DATADOG_TOKEN}"</script></a>
        <img src="/avatar.png?token=${SESSION}" alt="">
      </nav>`;
    const input = document.querySelector("input")!;
    input.value = `${PATIENT} typed`;

    const bundle = await capturedBundle();

    expect(bundle).not.toContain("Testpatient");
    expect(bundle).not.toContain(DATADOG_TOKEN);
    expect(bundle).not.toContain(SESSION);
  });

  it("redacts data-* values that look like tokens, identifiers or free text, and keeps keywords", async () => {
    document.body.innerHTML = `<button
      data-testid="save-order"
      data-client-token="${DATADOG_TOKEN}"
      data-app-id="11111111-2222-4333-8444-555555555555"
      data-ref="${PRACTICE_ID}"
      data-note="Called the patient back about the referral"
      data-api-key="abc">Save</button>`;

    const snapshot = await collectDomHealthSnapshot(document);

    expect(snapshot.elementReports[0]!.attributes.dataAttributes).toEqual({
      testid: "save-order",
      "client-token": REDACTED_VALUE,
      "app-id": REDACTED_VALUE,
      ref: ":id",
      note: REDACTED_TEXT,
      "api-key": REDACTED_VALUE,
    });
  });

  it("redacts every value and label inside a container the page marks as private", async () => {
    document.body.innerHTML = `
      <nav data-dd-privacy="mask">
        <a href="/chart" aria-label="Open ${PATIENT}" data-row="7">${PATIENT}</a>
      </nav>`;

    const bundle = await capturedBundle();

    expect(bundle).not.toContain("Testpatient");
    expect(
      collectSafeNavigationCandidates(document).map((c) => c.text),
    ).toEqual([REDACTED_TEXT]);
  });

  it("sanitizes URL values: secret-named and token-like parameters, and ids in the path", () => {
    expect(
      sanitizeAttributeValue(
        "href",
        `/ehr/${PRACTICE_ID}/chart?auth=x&view=list&k=${DATADOG_TOKEN}`,
      ),
    ).toBe(
      `/ehr/:id/chart?auth=${REDACTED_VALUE}&view=list&k=${REDACTED_VALUE}`,
    );
  });
});
