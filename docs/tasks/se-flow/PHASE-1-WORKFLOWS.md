# Phase 1 prompt: workflows, end to end, for 4.x and 5.x

You are a coding agent working in **Parthu-work/apty-super-hero**, on
branch `claude/amazing-gauss-1q2tme`. This prompt builds the SE debugging
flow for **one tool first: workflows**. The owner reviews the result before
the other tools (tooltips, launchers, validations, announcements,
checklists, knowledge content and the rest) are built in later phases.

**The master prompt is `docs/tasks/se-flow/IMPLEMENTATION-PROMPT.md`
(version 3).** It holds the rules, the confirmed design, the evidence in
Apty's code and the tests for every tool. This file only sets the
**scope** of Phase 1. Where this file says "in scope", follow the master
prompt's text for that item exactly. Where they seem to differ, the master
prompt wins, except on scope.

---

## 1. Read first

1. `CLAUDE.md`, `AGENTS.md`, `docs/STATUS.md`.
2. Master prompt **§0–§6 in full**: how to work, the rules (§1), what
   already exists (§2), the design and network-call policy (§3), facts
   (§4), owner decisions (§5), target architecture (§6).
3. `docs/development/se-flow-design.md` (the design; source of truth).
4. `docs/development/se-flow-coverage.md`: the workflow condition IDs
   (W5-xx for 5.x workflows and widget gates, F4-xx for 4.x flows, plus
   the P4, G5, G4, R4 rows named below).

**All master-prompt rules in §1 apply unchanged:** apty-dap and
apty-assist are read only; no Apty code is imported; every mirrored rule
cites `repo:path:line@commit` and records `verifiedOn`; GET only, no
credentials, catalogue paths and allowed hosts only; nothing on disk;
customer scripts never executed unless O-4; no new permission or runtime
dependency unless a decision allows it; never weaken a test; fail-then-pass
proof for each behaviour change; `npm run preflight` green per WP; do not
push or open a pull request unless the owner asks.

## 2. Ask the owner first

Ask the §5 owner decisions in one message (O-3, O-4, O-5, O-6, D-UA,
D-WIN, D-KB, D-CLIENT, D-SELFHOSTED, D-ASKFIRST, D-DAPTY-WHEN). Start the
WPs that do not depend on them meanwhile. A default applies only if the
owner replies "use defaults".

## 3. What the SE must be able to do at the end of Phase 1

On a customer page with Apty 4.x or 5.x (extension or injected mode), with
**no Apty Client record and no saved extension ID**, the SE types one of:

| Symptom | Examples of what the SE types |
|---|---|
| **S-LIST** (workflow items only) | "Create a lead isn't in the widget", "workflow missing from the list" |
| **S-AUTO** | "workflow isn't popping up", "doesn't start automatically", "auto-trigger not working" |
| **S-LAUNCH** | "clicking the workflow does nothing", "launcher doesn't open the workflow", "the link doesn't start it", "Ask Dapty's suggestion doesn't open it" |
| **S-STEP** | "stuck on step 3", "step broken", "highlights the wrong element", "ends early", "goes to the wrong branch" |

and gets, with no other input unless the Agent asks for missing IDs:

1. the context resolved (page probe, URL match, or one intake card);
2. a **live checklist** of every step, each with status and source;
3. **one result**: "Issues found, please fix all of these", each issue
   with cause, evidence and fix (or "No issue found in Apty's data", "Could
   not read Apty's data", "Possible causes to check");
4. Ask Dapty's guidance in parallel (or the KB card when Ask Dapty gives
   up, errors or may have answered from the web);
5. **Ask AI anyway** only when nothing was found, there is no KB answer
   and no card.

A bare how-to about workflows ("how do I make a workflow start
automatically?") makes **no content requests**.

Every other symptom keeps today's behaviour: the existing router and check
packs still answer tooltips, launchers, validations, widget, Ask Dapty,
logs and page readiness exactly as before. Do not remove or weaken them.

## 4. Scope by work package

Legend: **Full** = do the whole master-prompt WP. **Workflow** = only the
items listed. **Later** = do not build in Phase 1.

| WP | Scope | What to build in Phase 1 |
|---|---|---|
| WP0 Baseline | **Full** | |
| WP1 Drift and coverage manifest | **Full** | Fix WNV-07 (5.x widget display per environment; it decides whether a workflow can be listed at all). Build the coverage manifest and `audit:apty-coverage`, populated with every condition implemented in Phase 1 |
| WP2 Version adapters | **Full** | Both versions: probes, ID shapes, URL matching, version stamps, paths, `&token=` |
| WP3 Remove the Client dependency | **Full** | |
| WP4 Schema-drop mirrors | **Workflow** | `app-urls.json`, `app-data.json`, `content-config.json`, `workflow.json`, `workflow-steps-{id}.json`, `rule.json`, `segment.json`, `users/{id}.json`, locale files (5.x); `app-urls.json`, `app-data.json`, `feature-flag.json`, `flow.json`, `flow-{id}.json`, `segments.json`, `rules.json`, `form.json` (4.x). Other files later |
| WP5 Rule and segment evaluation | **Full** | Including world parity (WP16 item 3's table) |
| WP6 Symptom router and intake | **Workflow** | The router returns all routes; implement S-LIST (workflow items), S-AUTO, S-LAUNCH, S-STEP and the bare how-to route. The intake card in full (IDs, version, user ID, dev-mode User ID read first, `pinContext`, tenant-mismatch confirm, D-ASKFIRST setting). All other symptoms fall through to the existing router |
| WP7 Live checklist | **Full** | |
| WP8 5.x check groups | **Workflow** | `load-5x.ts` (all **Load** items), the **Widget** item (WP1), **Item / List** items that apply to workflows, `autotrigger-5x.ts` (**Auto-trigger**), `launch-5x.ts` (**Launch**: widget click, launcher target, the shared gate, permalink `WF:`, start step, whole-file steps parse), `steps-5x.ts` (**Steps**: order gap, element, frames, timing, advance, split, balloon visibility, resume, hidden step UI), the workflow-name part of **Locale**, **User history**. Tooltip, launcher-as-content, validation, announcement, checklist and KC groups later |
| WP9 4.x check groups | **Workflow** | `load-4x.ts` (**Load / Widget**), `flow-4x.ts` (**Flows (list)**, **Auto-trigger**, **Launch**, **Steps**), `frames-4x.ts` (**Frames**), the flow-name part of **Locale**. Other groups later |
| WP10 Case run | **Full** | For the four workflow symptoms; each group exports `files(version, symptom)` |
| WP11 Ask Dapty and the cards gate | **Full** | |
| WP12 Ask AI anyway | **Full** | |
| WP13 Accuracy and measurement | **Workflow** | Measures and registry for the Phase 1 rules; the real-tenant smoke script (run only if the owner gives a test tenant) |
| WP14 Production readiness | **Workflow** | Every item that touches code built in Phase 1 (security review of new page readers, limits, abort on close, docs for the new settings) |
| WP15 End-to-end matrix | **Workflow** | The four workflow symptoms × 4.x and 5.x, plus the bare how-to, with every assertion in WP15 items 1–8 and the WP11 "give-up does not change the diagnosis" test |
| WP16 Customer scripts | **Workflow** | Script inventory, parse, static references, page CSP and world parity for the kinds that can stop a workflow: 5.x rule `customScript`, DOM_CHANGE scripts (feed audience rules), element `CUSTOM_SCRIPT`, step CTA click actions, `domConfig` functions (all element lookup); 4.x `segment-js.js` (including SCR-13 freeze and SCR-14), `customScriptPool`, type-2 element scripts, `step.script` with `letzNavApi.flow.*`, decision points. Also 5.x APPLICATION_LOAD scripts (they can set what rules read) and Workday / Salesforce session inputs; 4.x `custom-js.js` (static checks) and smart-canvas buttons that launch a workflow (`data-flow-id` + `data-step-id`). Checks SCR-01…SCR-17, SCR-19…SCR-22 (all except SCR-18, custom-css). This covers 4.x D-02, D-03, D-05, D-07, D-08, D-09, D-10, D-13 and D-14 (workflow buttons). O-4 runner only if the owner allows it |
| WP17 Platform | **Workflow** | 5.x C-1, C-2, C-3, C-4, C-5, C-6, C-7, C-8, C-9, C-10, C-14, C-15, C-16, C-17, C-18. 4.x D-01, D-04, D-06, D-15, D-16, D-17, D-20, D-21, D-22, D-23, D-24, D-25, D-26, D-27, D-28, D-32 (WF only), D-33, D-34, D-35, D-37, D-38, D-39, D-41, plus D-18, D-19, D-29 (tags hide flows), D-30 (most-used and favourite flow sections), D-31 (search needs 2+ characters and a locale keyword), and the 4.x feature-flag map rows for S-WIDGET, S-LIST, S-AUTO, S-LAUNCH, S-STEP |

## 5. The workflow checks, both versions

The checklist for any workflow symptom runs, in this order, only the
groups the symptom needs (master prompt WP6 table):

| Gate | 5.x (WP8 / WP16 / WP17) | 4.x (WP9 / WP16 / WP17) |
|---|---|---|
| Platform | C-1 player ≥ 5.2.2 when the file uses `EVERY_TIME` or `CUSTOM_SCRIPT`; C-8 extension present; C-9 window-script alive; C-6 self-hosted; C-16 dev-mode User ID | Feature flags (publishing, Pulse, self-hosted, SSO, RegExp); D-01 segment-js freeze; D-06 `window.var.js` loaded; D-24 injected attributes; D-23 config cache |
| Load | `app-urls.json` (one invalid row), `app-data.json`, theme, locale, injected storage iframe, `restrictionPatterns` | OneX, test extension, env-key string sort, flag defaults, SSO, empty `app-data.json`, `baseTag`, `restrictURLs`, segment-hidden widget, publishing off |
| Widget | WNV-07 fixed: per-environment `widgetDisplayConfig`, missing = hidden | `widgetConfig.display` + `enabledForOtherUser`, `hideAptyWidgetWhenNoContent` |
| Item | `workflow.json` present; name for the locale; whole-file schema drops; `hideFromWidget` | `flow.json` present; `name[locale]`; schedule; `hideInWidget`; tags (flag) |
| Audience | `segment.json` + `rule.json` evaluated on the page; inactive-only membership | `segments.json` evaluated; absent key false; JSONPath arrays |
| Rules | Visibility and entry-point rules (WP5); rule scripts (WP16) | `visibilityResult` fail-open ("?" until O-3, with inputs); rule scripts |
| Auto-trigger | `stepsAutoTrigger[]`; rule rise; `EVERY_TIME`; frequency vs user file; restriction; active dialog | `stepsAttachedRules[]` AutoTrigger; first eligible only; never-repeat defect; non-default user ID |
| Launch | Widget click, launcher target, shared gate, `WF:` permalink + autopilot, start step, whole steps file | Flow exists, error modal, empty steps file, announcement CTA, `WF-` permalink (silent unknown), autopilot |
| Steps | Order gap, element (screen token, container score, XPath, custom script), frames, timing, advance, split, balloon visibility, resume, hidden UI | First milestone, frames, element types, 6 of 9 hit points, step conditions, wait time, language change, expiry, step scripts, decision points, broken-step widget flag |
| User history | `users/{id}.json` parse; auto-trigger records; completions; C-2, C-3, C-4 | User file auto-trigger records; D-21 self-hosted; D-38 custom user ID |

Every row cites its apty-dap or apty-assist line and appears in the
coverage manifest.

### 5.1 Every condition in scope (none may be skipped)

These are all the workflow, widget-gate, load and platform conditions in
`docs/development/se-flow-coverage.md` that can make a workflow missing,
silent, unopenable or broken. **Each must be implemented as a checklist
row** (a cause, a "?" with the deciding value, or an info row, as the
inventory's last column says), **and listed in the coverage manifest**.
One left out makes Phase 1 partial; say which and why.

- **5.x load, widget and gates:** W5-01, W5-02, W5-03, W5-04, W5-05,
  W5-06 / G5-05, G5-06, W5-07 / G5-12, W5-08, W5-09, W5-10, W5-11, G5-10,
  G5-11, P5-01.
- **5.x workflow item, audience and rules:** W5-15 / G5-19, W5-16,
  W5-17, W5-18, W5-19, W5-20 / G5-17, W5-21 / G5-16, W5-22 / G5-15, W5-24.
- **5.x auto-trigger:** W5-26, W5-27, W5-28, W5-29, W5-30, W5-31, W5-33.
- **5.x launch:** W5-34, W5-35, W5-36, W5-37, W5-38, W5-40, W5-41.
- **5.x steps and run:** W5-43, W5-44, W5-45, W5-46, W5-48, W5-49,
  W5-50, W5-51, W5-53, W5-54, W5-56, W5-57.
- **5.x user history:** W5-59, W5-60 / W5-61, G5-22.
- **5.x scripts and platform:** SCR rows from §4 WP16; C-1…C-10, C-14,
  C-15, C-16, C-17, C-18.
- **4.x load and widget:** P4-01, P4-02, P4-04, P4-05, P4-06, P4-07,
  P4-08, P4-10, P4-11, P4-12, P4-13, P4-14, P4-15 / G4-02, P4-16, P4-17,
  P4-18, G4-01, G4-04.
- **4.x flows:** F4-01, F4-02, F4-03, F4-04, F4-05, F4-06, F4-07, F4-08,
  F4-20, F4-21, F4-22, F4-23, F4-26, F4-27, F4-29, F4-30, F4-31, F4-32,
  F4-34, F4-37, F4-38, F4-41, F4-45, F4-46, F4-63; frames R4-01 / R4-02.
- **4.x scripts and platform:** SCR rows from §4 WP16; D-01…D-10, D-13,
  D-14 (workflow buttons), D-15…D-35, D-37, D-38, D-39, D-41.

Before writing code for a group, re-read each of its conditions at the
cited line (master prompt §1.1). Where the inventory marks a row
"inferred" or NOT VERIFIED, implement it as status `candidate` until a
test or the real-tenant smoke test confirms it.

## 6. Proof required for Phase 1

- Unit tests per rule: one synthetic fixture where it fires and one where
  it does not; parity tests for the rule evaluator; schema-mirror tests for
  each Phase 1 file; script parse and world-parity tests.
- E2E (`tooling/e2e/se-flow-*.e2e.test.mjs`), fake 4.x and 5.x content
  hosts, fake ai-service SSE, mock Model A (OpenAI shape, exists) and a
  **new Anthropic mock for Model B**, no Client extension:
  - each of S-LIST, S-AUTO, S-LAUNCH, S-STEP × 4.x and 5.x, with at least
    one fixture per gate in §5 that produces the expected cause;
  - the bare workflow how-to: zero content requests;
  - Ask Dapty: KB answer, give-up, error, 20 s stall, unset → identical
    rows, causes and requests;
  - Ask AI anyway: A passes; A 401 → B passes; both fail → "Not enough
    evidence"; no button when an issue was found;
  - every request GET, no cookie, 4.x carries `token=`; request counts
    match master §3.2; no model request on the check path; no customer
    code ran (`window.__ran` stays undefined); `panel.consoleErrors` empty;
  - Re-check after a fixture change flips the row, with conditional
    requests;
  - the existing E2E suite, a11y (light and dark) and chat-scroll 400/480
    stay green.
- `npm run preflight` and every audit in master §1.4 green, including the
  new `audit:apty-coverage`.

## 7. Done when

1. Every WP row in §4 is **done** for its Phase 1 scope, or **partial**
   with exactly what is missing, and every condition in §5.1 is in the
   coverage manifest (`audit:apty-coverage` checks the list).
2. The four workflow symptoms work end to end for both versions with no
   Client record, as shown by the E2E above.
3. Every other symptom behaves exactly as before Phase 1 (the existing
   tests prove it).
4. `docs/STATUS.md` has a Phase 1 row per WP.

## 8. Hand-over for the owner's review

Write `docs/tasks/se-flow/PHASE-1-REVIEW.md` with:

1. commits per WP;
2. test output: unit counts, E2E list, audits;
3. each fail-then-pass proof;
4. owner decisions as answered;
5. any §4 fact (master prompt) found changed, with the new citation;
6. what is partial, and why;
7. what was not run (real tenant, Ask Dapty KB, real models);
8. **what Phase 2 can reuse as is**, and anything the Phase 1 foundations
   would need to change for tooltips, launchers and validations.

Do not push. Tell the owner the branch name and head commit.
