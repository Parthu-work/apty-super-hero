/**
 * M2: one page holding PHI-like strings in every place Strict promises to
 * mask (PRIVACY.md, "What is masked before it leaves your browser"), read
 * by every reading tool in one chat, and none of the strings in the
 * requests the model received. Page prose is not in the fixture: no mode
 * hides it, as PRIVACY.md says.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  chatAndWait,
  launchBrowser,
  openSidePanel,
  startMockModel,
  startPageServer,
  toolResults,
} from "./harness.mjs";

const PATIENT = "Jane Testpatient";
const RECORD_IN_PATH = "48151623";
const MRN = "884213";
const LABELLED_MRN = "4815162342";
const DOB = "1961-04-02";
const EMAIL = "jane.testpatient@example.com";
const TOKEN = `ghp_${"Ab12Cd34Ef".repeat(3)}`;
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI4ODQyMTMifQ.c2lnbmF0dXJlc2lnbmF0dXJl";

const PAGE = `<!doctype html><title>${PATIENT} - Chart</title>
<main>
<h1>Chart summary</h1>
<p>Contact ${EMAIL}. MRN ${LABELLED_MRN}. Key ${TOKEN}.</p>
<a href="/chart/${RECORD_IN_PATH}.html?mrn=${MRN}&dob=${DOB}">Reload</a>
<label>Patient <input name="patient" value="${PATIENT}"></label>
<label>Visit notes <textarea name="notes">Note-Marker-Asthma</textarea></label>
<label>Referral <select name="referral"><option>Other</option>
<option selected>Referral-Marker-Cardio</option></select></label>
<div contenteditable="true" aria-label="Summary">Editor-Marker-Seven</div>
</main>
<script>
setInterval(() => {
  console.error("load failed for ${EMAIL} token=${JWT}");
  fetch("/api/patient?mrn=${MRN}&dob=${DOB}").catch(() => {});
}, 250);
</script>`;

const LEAKS = [
  PATIENT,
  "Testpatient",
  RECORD_IN_PATH,
  MRN,
  LABELLED_MRN,
  DOB,
  EMAIL,
  TOKEN,
  JWT,
  "Note-Marker-Asthma",
  "Referral-Marker-Cardio",
  "Editor-Marker-Seven",
];

let browser;
let model;
let site;

before(async () => {
  model = await startMockModel();
  site = await startPageServer({ [`/chart/${RECORD_IN_PATH}.html`]: PAGE });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  model?.close();
  site?.close();
});

describe("masking proof (M2)", () => {
  it("lets no PHI-like string on the page reach the model through any reading tool, in Strict", async () => {
    const url = `${site.origin}/chart/${RECORD_IN_PATH}.html?mrn=${MRN}&dob=${DOB}#${EMAIL}`;
    const app = await browser.context.newPage();
    await app.goto(url);
    const tabId = await browser.agentWorker.evaluate(
      async (origin) =>
        (await chrome.tabs.query({})).find((t) => t.url?.startsWith(origin))
          ?.id,
      site.origin,
    );
    const steps = [
      () => ({ tool: "get_all_tabs", args: {} }),
      () => ({ tool: "get_current_tab", args: {} }),
      () => ({ tool: "get_tab_info", args: { tabId } }),
      () => ({ tool: "get_page_metadata", args: {} }),
      () => ({ tool: "search_elements", args: { tabId, query: "*" } }),
      (results) => {
        const text = JSON.stringify(results);
        const uid = /uid=([^\s\\"]+) textbox \\?"Visit notes/.exec(text)?.[1];
        assert.ok(uid, "search_elements named the notes field");
        return { tool: "get_editor_value", args: { tabId, uid } };
      },
      () => ({ tool: "get_runtime_diagnostics", args: { windowMs: 1500 } }),
      () => ({
        tool: "get_network_diagnostics",
        args: { windowMs: 1500, onlyErrors: false },
      }),
      () => ({ tool: "run_dom_health_audit", args: {} }),
    ];
    const ran = [];
    model.script((request) => {
      const results = toolResults(request);
      const next = steps[results.length];
      if (!next) return { text: "RESULT: done" };
      const call = next(results);
      ran.push(call.tool);
      return call;
    });
    const panel = await openSidePanel(browser, model, app);

    await chatAndWait(
      panel,
      "Investigate this page: show the page metadata and my open tabs, the form field values, the console errors and network requests, and check dom health",
    );

    assert.deepEqual(
      ran,
      steps.map((_, i) => ran[i]).filter(Boolean),
      "the tools ran in order",
    );
    assert.equal(ran.length, steps.length, `ran: ${ran.join(", ")}`);
    const sent = JSON.stringify(model.requests);
    assert.deepEqual(
      LEAKS.filter((needle) => sent.includes(needle)),
      [],
    );
    const last = model.requests.at(-1);
    assert.equal(toolResults(last).length, steps.length);
    assert.match(sent, /Chart summary/, "the page itself was read");
    await panel.close();
    await app.close();
  });
});
