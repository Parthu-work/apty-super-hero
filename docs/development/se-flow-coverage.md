# SE flow coverage: every condition the player checks, for 4.x and 5.x

Status: **design**. This is the reference the checks are built from. It
lists every condition the Apty player evaluates before content shows or
works, for each symptom an SE reports, and for both versions. Each
condition is mapped to a checklist row the Agent will show, and the
inventory is re-checked against each Apty release (§7).

- Sources, read only:
  - apty-dap `3f3adba`, paths under `packages/`.
  - apty-assist `bbb4cbc`, paths under `player3.0/src/`.
- Conditions marked **✔** were re-read and confirmed while writing this.
  The rest come from line-by-line reading of the cited code.
- Everything here is **from code, not runtime-verified**, until the
  real-tenant smoke tests in §7 run.

Decidability codes:

- **F**: the published files alone.
- **U**: files plus the user's `users/{userId}.json`.
- **P**: the open page (DOM, URL, window, page storage).
- **E**: the Agent evaluates the rule itself on the page (§3).
- **R**: runtime-only. The value lives only inside the running Client, and
  the row says "not checked" with the reason.

Ask Dapty's endpoint, and the content-file catalogue, paths and
timestamps, are in [replay-network-source.md](replay-network-source.md)
and [se-flow-architecture.md](se-flow-architecture.md).

## 1. What the SE gives, and what the Agent does with it

The SE's whole job is to say **what is wrong** and, when the Agent cannot
read it from the page, **which tenant, application and environment**.
Everything else is the Agent's work.

| Input | Needed for | How the Agent gets it | Asked only when |
|---|---|---|---|
| The symptom and the item's name (e.g. "workflow 'Create a lead' does not start") | Choosing the checks; finding the item | The SE's message, parsed into a symptom and an item (§2) | Never; it is the question |
| Tenant, application, environment | Every file | Page probe, then URL match (5.x: `active-application.helpers.ts:3-45`; 4.x: `injected.helpers.ts:24-49`) | The page has no readable Apty, or a 4.x page where no application matched (the Client then never adds `window.var.js`, `main.bootstrap.ts:162-170`), or the SE wants another environment |
| The affected page, open in the tab | Element, frame, rule-input and page-console checks | The tab the case is bound to | The symptom needs the page and the tab is not on it. The Agent says which page to open; it never guesses an element verdict without the page |
| The user's identifier | Per-user conditions: auto-trigger frequency, completion, recurrence, favourites, feedback | 5.x: the value `app-data.json` `config.userIdentificationConfig` names, read from the page (`user-tracking.service.ts:46-76`). 4.x: `userIdentification` (`user-identification.effects.ts:70-163`) | The check reaches a user-dependent condition and the ID is not on the page. Example: an Apty ID kept in the Client's extension storage (5.x `user-tracking.service.ts:153-172`; 4.x `aptyId.helper.ts:5-18`). The Agent then asks once, with a one-line way to copy it |
| The version | Choosing the adapter | Probe, then ID shape (UUIDs mean 5.x; short key plus numbers mean 4.x) | Neither settles it |

**Item lookup.** Exact name first, then sourceId or id, then part of the
name. Several matches give one question: "which one?", with the
candidates' names and environments. This exists today in
`diagnosis/lookup.ts`.

## 2. Symptoms and the checks each runs

The router maps the SE's words to one or more symptoms. The case run then
starts **every** check group the symptom needs, in parallel, on one
replay. "Item" means the workflow, tooltip or other content the SE named.

| Symptom | Check groups (§4, §5) |
|---|---|
| Widget not visible | Load, Widget |
| Item missing from the widget list | Load, Widget, Item, Audience, Rules, List |
| Workflow does not start by itself | Load, Item, Audience, Rules, Auto-trigger, User history |
| Workflow does not open when clicked (widget, launcher, link, Ask Dapty, announcement) | Load, Item, Audience, Rules, Launch, Steps file |
| Workflow step stuck, broken, wrong element, ends early, wrong branch | Steps file, Step play, Element |
| Tooltip not visible | Load, Item, Audience, Rules, Element, Schedule (4.x) |
| Launcher not visible, or click does nothing | Load, Item, Audience, Rules, Element, Launch target |
| Validation not firing or not disabling | Load, Item, Audience, Rules, Element, Validators |
| Announcement not showing, or shows again | Load, Item, Audience, Rules, Schedule/recurrence, User history |
| Checklist missing or items not ticked | Load, Item, Checklist items, User history |
| Knowledge content missing or not opening | Load, Item, Audience, Rules, List |
| Wrong language, or text missing | Load, Locale, Item texts |
| Onboarding task missing (4.x) | Load, Onboarding |
| Ask Dapty: wrong, missing or no answer, or a suggestion opens nothing | The existing Ask Dapty pack, plus Item / Launch for the suggested item |

## 3. Evaluating rules and segments on the page (the main accuracy lever)

Most "it shows for some users and not others" causes are rule and segment
results. Today they are "?". The Agent can decide most of them itself.

### 3.1 5.x: run the same rule logic on the page

The 5.x engine is small, pure and deterministic. It lives in
`libs/shared/rules-engine/src/rule/`: `rule-evaluator.ts`, `compare.ts`,
`predicate.ts`, `resolver.ts` and `types.ts`.

**The grammar.**

- Groups combine with `AND` or `OR`, short-circuited. There is no `NOT`.
- A condition is `left var` · operator · `right literal | var | array`.
- `eq` and `neq` are strict, with no type coercion ✔ (`compare.ts:60-75`).
  A missing value makes `neq`, `notContains` and `notIn` **true**.
- `gt`, `gte`, `lt` and `lte` try a string as a date first. V8 then reads
  `"5"` as 2001-05-01.
- `regex` uses no flags. An invalid pattern throws, which fails the whole
  rule pass.
- Predicates: `isValidEmail`, `isNumber` and `isEmpty`.

**Segments.**

- A segment is active iff `results[segment.ruleId] === true` ✔
  (`apps/player/src/main-content-script/segment/segments.service.ts:51-55`).
- An item's segments are the `segment.json` rows whose id lists contain
  its `sourceId`. Rows with `isActive:false` count too (`workflow.mapper.ts:60`).
- An item with no segments passes. Otherwise **any** active segment is
  enough ✔ (`visibility-rules/segments-rule.service.ts:26-34`).

**Where each variable comes from, and what the Agent can read:**

| Source | Agent can read the same value | How |
|---|---|---|
| `page` (url, host, path, search, hash, referrer, title, `<html lang>`, params) | yes | Tab URL and DOM, top frame |
| `window` | yes | MAIN world. Same dotted walk, calling functions on the way, then `String()` (`rules-evaluation/src/main-world/window-ipc-handles.service.ts:27-46,84-94`; `context/rule-evaluation-context.service.ts:192-206`) |
| `localStorage`, `sessionStorage` | yes | MAIN world. A missing key is `null` |
| `cookie` | yes | `document.cookie`, never `chrome.cookies`, so HttpOnly cookies stay out. A missing cookie is `undefined` |
| `dateTime`, `os`, `browser`, `device`, `country` | yes | The same clock and timezone. A user-agent parser and a timezone-to-country table matching the player's (`rules-engine/src/browser-context.ts:12-53`) |
| `augmentation` | yes, while the player runs | MAIN world `window.aptyAugmentation` (`player-rule-evaluation.bindings.ts:185-190`) |
| `element` (`<id>.exists/visible/text`) | partly | The Agent's element probe. Exact parity with `lib-client-element-identification` (container score ≥ 0.75, screen token) is a build item |
| `customScript` | not by default | Running customer JavaScript from a published file is a security decision (open decision O-4). Until it is made: "?" with the script named |
| `userActivity.toolProgress` | yes, with the user ID | `users/{userId}.json` |
| `userActivity.lastActivityTime` | no | Kept in the Client's extension storage. "?" |

**The result.** Each segment and visibility-rule row says:

- "✓ / ✗ evaluated on this page", with the condition that decided it
  (`localStorage.role = "admin"`, rule expects `"sales"`); or
- "? not decidable", naming the source that blocks it.

The Agent's evaluator is written in agent-core, not imported from Apty.
It is kept identical by a parity test set (§7).

### 3.2 4.x: segments yes, rules only with access to two more libraries

**Segments.** Segments are in `segments.json` `conditions[][]`.

- The outer list is OR; each inner list is AND (`segments.helpers.ts:11-21`).
- Each condition runs a JSONPath on `key` over the player's metadata.
- **An absent key is false, even for `not_equals`** ✔
  (`segment-executor.helpers.ts:166-168`).
- `equals` compares joined strings exactly; `contains` and `in_list` are
  lowercased.
- When no segment is active, everything passes (`segments.selectors.ts:42-70`).

The Agent can compute these metadata keys from the page:

- `platform_*`, `page_*`;
- the storage and window values named by conditions (`segments.helpers.ts:92-120`);
- `user_id` from `localStorage['apty-user-id']`.

Keys under `application_customData` come from the customer's
`segment-js.js`, which is arbitrary JavaScript. They are "?" unless open
decision O-4 allows sandboxed execution. A JSONPath key containing `?(`
or `(` is evaluated by the player as code; the Agent treats keys as plain
paths only.

**Rules.** 4.x rules (`rules.json`) are evaluated by `@apty/rules-engine`.
Frames and elements are evaluated by `@apty/extension-core`. Both are
separate aptyInc repositories ✔ (`player3.0/package.json:29-30`) and are
not in this checkout. Until the owner grants read access (open decision
O-3), 4.x rule results stay "?". These rows still show the rule's
inputs:

- the window variables, read from the page;
- CSS and XPath elements, found on the page;
- tools progress, from the user file.

## 4. 5.x (apty-dap): conditions and their rows

### Load: the player starts on this page

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-03 | The URL matches an env pattern. `*` becomes `.*`, unanchored (substring). Envs are taken by `order`, apps in file order | `app-urls.json` | `cdn.service.ts:122-143`; `active-application.helpers.ts:3-45` | F+P | exists: WNV-02/03 |
| W5-04 | `app-urls.json` is parsed whole: one invalid row turns it into `[]` | schema | `cdn-reader-api.ts:99-108` | F | **new**: name the invalid row |
| W5-05 | `app-data.json` exists and parses whole, else "No application found" | schema | `cdn.service.ts:181-185` | F | **new** |
| G5-05 / W5-06 | Any async service init error kills the player: rules, themes, segments, restriction, locale, permalink | — | `ioc.ts:56-63,79` | R; the causes below are F | **new**: run each init's file check |
| G5-06 | `app-data.defaultThemeId` exists in `default-themes.json` ∪ `theme.json` | files | `theme.mapper.ts:27-31` | F | **new** |
| W5-07 / G5-12 | At least one `enabled` locale exists, and `locales/{code}.json` resolves | `application-locales.json` | `cdn.service.ts:208-226,577-599`; `locale.service.ts:30-54` | F+P | **new** |
| W5-02 | Injected mode only: the storage iframe loads within 15 s | page | `index-injected.tsx:25-41` (`15000` at 28; widget starts after the iframe, 62-70) | P | **new** |
| W5-01 | Top frame only; other frames run only the iframe script | page | `apps/player/wxt.config.ts:75-78` (`all_frames: false`; injected mode has no top-frame guard, INFERRED) | P | info |

### Widget

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-08 ✔ | The display mode is **per environment**: `environments[envId].widgetDisplayConfig`. Missing means **None (hidden)**. The app-level `widgetConfig.display`, `selectedSegments` and `enabledForOtherUser` are **ignored** | `app-data.json` | `segments.service.ts:64-80`; `application-config.schema.ts:287-295`; changed in apty-dap `9b2eef11` (2026-11-16) | F | **fix existing WNV-07** (it reads the app-level fields) |
| W5-09 | `Specific`: one of `selectedSegments` is active | segments, rules | `segments.service.ts:74-77` | E | **new** (with §3) |
| W5-10 | Display stays false while rule results are still null | — | `segments.service.ts:43-49` | R | info |
| W5-11 | No `restrictionPatterns` regex matches the URL (unanchored; blank and invalid patterns skipped). This hides everything, including auto-trigger | `app-data.json` `config.widgetConfig.restrictionPatterns` | `widget-restriction.service.ts:10-11,28-67` | F+P | exists: restriction gate |
| G5-10 | `environment.enableWidget`, the environment-level visibility rule, `enabledForOtherUser` and `enableForInjectedWidget` are **never read** | — | grep | F | **new**: say "this setting has no effect in 5.x" when the SE points at one |
| G5-11 | `features.aiAssistant` / `reminders` hide widget tabs; self-hosted forces AI off | `app-data.json` | `WidgetTabBar.tsx:44,60`; `cdn.service.ts:194-206` | F | exists for AI (DAP-01) |

### Item: present and well-formed

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-15 / G5-19 | List files are parsed **per item**: an invalid item is silently dropped. Example causes: <ul><li>the visibility pair `visibilityRuleId` / `visibilityRuleAction` not both set or both null</li><li>the auto-trigger trio not all-or-none</li><li>a non-UUID id</li><li>a missing boolean</li><li>`order` outside 1–9999</li><li>a blank `locales[].name`</li><li>empty success or feedback HTML</li><li>a missing required field (tooltip `screenshotConfig`)</li></ul> | each schema | `axios-client.ts:116-140`; `workflow.schema.ts:30-76,150-183`; `tool.schema.ts:7-59` | F | **new**: "dropped by the player: field X" |
| CNV-02 | Published in this environment | item file | — | F | exists |
| W5-16 | The workflow name resolves: the current locale's row, else `en` (not the app default). Blank counts as missing | `locales[]` | `workflow.mapper.ts:29-40`; `locale-fallback.ts:15-31` | F | exists: CNV-04/05/13 (check the `en` fallback rule) |
| W5-17 / W5-18 | `enableSuccess` / `enableFeedback` need a non-blank message, else the workflow is dropped | `locales[]` | `workflow.mapper.ts:31-37` | F | **new** |
| T5-01 ✔ | Tooltip: **every** `locales[].contentHTML` must have text or media. One blank row drops the tooltip in **every** language | `tooltip.json` | `tooltip.schema.ts:35-41`; `smart-canvas-utils.ts:192-198` | F | **new** |
| T5-02 | Tooltip: the resolved `contentHTML` is non-empty | `locales[]` | `tooltip.mapper.ts:44-52` | F | **new** |
| L5-03 | Button launcher: `buttonLabel` resolves | `locales[]` | `launcher.mapper.ts:107-117` | F | **new** |
| K5-01 | Knowledge content: `hideFromWidget` **defaults to true** when absent | schema | `knowledge-content.schema.ts:52` | F | **new** |
| A5-02 | Announcement: a locale row or a resolvable popup | `announcement.json`, `popup.json` | `announcement.mapper.ts:129-140` | F | **new** |

### Audience and rules

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-20 / G5-17 | Segment gate. Membership comes from `segment.json` lists by `sourceId`, never `item.segmentIds`. Active means `isActive && rule === true`. Listed only in `isActive:false` segments means hidden from everyone | `segment.json`, rules | `workflow.mapper.ts:60`; `segments-rule.service.ts:26-34` | F (membership) + E (activity) | exists: CNV-07/08; **new**: evaluated activity |
| H (drops) | A dropped `segment.json` row makes its items unsegmented (visible to all). A dropped `rule.json` row hides items whose visibility rule pointed at it | schema | `axios-client.ts:116-140` | F | **new** |
| W5-22 / G5-15 | Visibility rule: `results[visibilityRuleId]` must be true. `visibilityRuleAction` HIDE is **ignored** (always SHOW). A rule missing from `rule.json` hides the item | `rule.json` | `rule-engine.mapper.ts:13-24`; `rule-engine-visibility-rule.service.ts:20-41` | F (missing) + E | exists: listed; **new**: evaluated, and "HIDE has no effect" |
| W5-21 / G5-16 | Waits 5×10 ms for segments and 15×100 ms for rules; still null means hidden | — | `segments-rule.service.ts:18-24`; `rule.service.ts:15-26` | R | info |

### Widget list

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-19 / K5-04 | `hideFromWidget` / `hideInWidget` hides from the list only; launchers, auto-trigger, permalinks and Ask Dapty still work | item | `cdn.service.ts:418` | F | exists: CNV-03 |
| W5-24 | Completed workflows stay listed | — | `cdn.service.ts:383-418` | F | info |
| K5-07 / K5-08 | Labels and most-used group **workflows only** | `labels.json`, `most-used-content.json` | `widget.mapper.ts:12-96` | F | **new** (info) |
| K5-10 | Search needs 2+ characters and matches name and keywords. **Tags are not searchable** | — | `search-filter.controller.ts:8-81` | F | **new** (info) |
| K5-11 | `process-group.json` is never read | — | grep | F | info |

### Auto-trigger (workflow "pops up by itself")

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-26 ✔ | Only `stepsAutoTrigger[]` (`attachedRule.{id, ruleAction.toolDetails.stepId, metaData.frequency, delay}`) drives auto-trigger. The workflow-level `autoTriggerRuleId`, `Frequency` and `Delay` are **not read** | `workflow.json` | `workflow.mapper.ts:89-93`; `cdn.service.ts:452-466` | F | **new** |
| W5-27 | The attached rule is true | `rule.json` | `workflow-autotrigger.service.ts:68-78,178-186` | E | **new** |
| W5-28 | `EVERY_TIME` needs the rule to go false → true; a rule true at load counts | — | `workflow-autotrigger.service.ts:47-66,92` | E (at load) / R (after) | **new** |
| W5-29 ✔ | Frequency against `users/{uid}.json` `toolsCompletionProgress.autoTriggerData.flows[workflowId][stepId]`: <ul><li>no record: eligible</li><li>`ONCE` or null: never again</li><li>daily, weekly, monthly: at least 1 day, week or month since</li><li>an unknown frequency reads as `ONCE`</li></ul> | user file | `workflow-autotrigger.service.ts:100-125` | U | **new**: "already triggered on <date>; frequency ONCE" |
| W5-30 | Skipped while widget-restricted; display mode **not** checked | — | `workflow-autotrigger.service.ts:175-177` | F+P | **new** |
| W5-31 | Skipped while any dialog is active: a stored run (even paused), a knowledge-content item, an announcement or a checklist success | Client storage | `active-dialog.service.ts:23-29` | R | **new** ("?", with what to close) |
| W5-33 | `autoTriggerData` is written on activation, not completion | user file | `workflow-autotrigger.service.ts:155-166` | U | info |

### Launch

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-34 | A widget-list click is not re-gated, and cancels any current run | — | `use-help-list.controller.ts:36-59` | F | info |
| W5-35 | Launcher: `launcherAction.toolId` is a workflow in the tool list. Its own visibility passes. It is not rendered when display is off or restricted | `launcher.json` | `cdn.service.ts:524-560`; `ContentScriptRoot.tsx:19-30` | F+E | **new** |
| L5-02 | Launcher target exists and is visible: <ul><li>a workflow with name, success and feedback texts</li><li>a knowledge content item</li><li>a popup in `popup.json`</li></ul> Other target types are dropped | files | `cdn.service.ts:524-561` | F+E | **new** |
| W5-36 | Gate for launcher, Ask Dapty, announcement, auto-trigger and step call-to-action: the workflow exists and passes segments and visibility rule | — | `cdn.service.ts:444-450` | F+E | **new** |
| W5-37 | Ask Dapty suggestions launch with step `''` (entry step) and pass the gate | — | `AiChat.tsx:74-81` | F+E | exists: DAP-06 (extend with the gate) |
| W5-38 | Permalink `aptyref=WF:<sourceId>[:<stepSourceId>]`, read once and removed from the URL. **Not gated**. Autopilot needs `autopilot=true` and `enableAutoPilot` | URL | `permalink.service.ts:29-126` | F+P | **new**: parse the link the SE pastes |
| W5-40 | Start step, in order: the requested step; else the **last** attached step with `enableEntryPoint` whose `entryPointRuleId` is true; else `order===1`; else launch fails silently | `workflow-{id}.json` | `workflow-step.service.ts:129-143` | F+E | **new** |
| W5-41 | `workflow-{id}.json` is parsed **whole**: one invalid step means nothing launches. Example causes: non-UUID id, `order` below 0, empty `advanceOn`, `optionalTimeOut` below 1, empty step HTML, bad `splitStep` | schema | `cdn-reader-api.ts:73-84`; `workflow-step.schema.ts:32-256` | F | **new**: name the invalid step and field |

### Step play

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-43 | Element found. CSS, jQuery or picker selection with: <ul><li>the `screenTokenFunction` gate</li><li>shadow roots</li><li>a rendered match preferred</li><li>**container score ≥ 0.75**</li></ul> XPath and custom script are also supported. Shadow fallback and dynamic search are off | step `.element`; `app-data.json` `domConfig` | `element-identification.service.ts:42-134`; `scope.ts:137-141`; `application.mapper.ts:26-51` | P | exists: SEL-*; **new**: container score, screen token |
| W5-44 | Frames: `iframePath` levels must match ready, rendered iframes | step | `filter-iframe-tool-items.ts:35-102` | P | exists: SEL-05/12 |
| W5-45 / W5-46 | Timing: one attempt, then 1 s retries up to `optionalTimeOut` (or 5 s). An optional step is skipped; otherwise "Step broken", which recovers when the element appears | step | `ipc.service.ts:330-365` | F+P | **new** |
| W5-48 | The balloon needs element visibility unless `showWhenOutsideViewPort` is set | step, DOM | `AttachedStep.tsx:104-111` | P | exists: SEL-09/10 |
| W5-49 | Advance: `advanceOn[]`. Click listens to `workflowAdvanceOnClickEventType` (default `mousedown`). An unknown value reads as Next | step; `app-data.json` | `use-flow-step-advance-on.controller.ts:20-94` | F+P | **new** |
| W5-50 ✔ | Next step is **exactly** `order + 1`. A gap ends the run early as "done" | step `order` | `workflow-step.service.ts:150-153` | F | **new** |
| W5-51 | Split step: rule tried 5×1 s, then end, jump, or start another workflow; never true means `order + 1` | step `.splitStep` | `workflow-step.service.ts:88-127` | E | **new** |
| W5-53 | Resume after navigation: the same app/env must resolve, and the workflow must still be published. A missing step falls back to the entry step. Visibility is **not** re-checked | Client storage | `workflow-engine.service.ts:186-202,545-614` | F+P (+R stored run) | **new** |
| W5-54 | Run expiry: `contentRunExpiryTime` minutes (≤0 or null means 30), timer in memory | item | `workflow-engine.service.ts:903-914` | F | info |
| W5-56 | Step UI renders only when display is on and not restricted. An auto-triggered or linked run under display None is invisible | — | `ContentScriptRoot.tsx:19-40` | F+P | **new** |

### Completion and user history

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| W5-57 | Completes when there is no `order + 1` step, on split end, or on hand-off | — | `workflow-engine.service.ts:136-166` | F | info |
| W5-59 | Feedback shows only if not already in `workflowsFeedback[]`; it is recorded on submit only | user file | `flows-user-preference.service.ts:14-56` | U | **new** |
| W5-60 / W5-61 | "Not offered again" comes only from the auto-trigger frequency and rules that use `userActivity.toolProgress.WORKFLOW` | user file, rules | `player-rule-evaluation.bindings.ts:207-226` | U+E | **new** |
| G5-22 | The user file is parsed whole; any schema failure means empty preferences (completions forgotten) | schema | `libs/shared/cdn-api/src/cdn-reader-api.ts:86-98` (`getWithFallback`); `application-environment-files.ts:216-222` | U | **new** |

### Other content types

| ID | Condition | Code | Dec. | Row |
|---|---|---|---|---|
| T5-04 … T5-07 | Tooltip element, frame depth, visibility (6 of 9 hit points plus viewport), ICON vs FLOATING trigger | `element-visibility.service.ts:9-90`; `tooltip.mapper.ts:74-87` | P | exists: SEL-*; **new**: trigger mode |
| V5-04 … V5-08 | Validation validators (required, length, regex, custom, each only when enabled). A disable group is blocked while **any** validation on it is invalid, including empty at mount | `validation.mapper.ts:49-112`; `validation.service.ts:40-93` | F+P | **new** |
| A5-04 | Announcement "Later": host `sessionStorage['apty_player_session_storage_later_announcements']` contains the item | `later-rule.service.ts:15-22` | P | **new** |
| A5-05 | NONE/ONCE: an accepted completion in the user file hides it for good. **`scheduleRange` dates, times and time zone are not enforced** | `announcement.mapper.ts:75-167`; `recurrence-rule.service.ts:259-264` | U | **new** |
| A5-06 | REPEAT: <ul><li>not already shown this period</li><li>daily, weekly, monthly or yearly arithmetic</li><li>`maxOccurrences`</li></ul> There is **no end-date or start-date guard**, and it uses browser-local time | `recurrence-rule.service.ts:35-252` | U | **new** |
| A5-07 | Only one announcement shows: the first by `order`, then by name. Blocked while any dialog is active | `cdn.service.ts:693-714`; `active-dialog.service.ts:23-29` | F+R | **new** |
| A5-08 | Permalink `AN:` bypasses every check | `permalink.service.ts:120-122` | F+P | **new** |
| C5-02 / C5-03 / C5-05 | Checklist items need a visible, locale-valid target. A checklist with 0 items is dropped. An item is ticked iff its id is in `flows[]` / `customContents[]` | `checklist.mapper.ts:261-298`; `cdn.service.ts:481-507` | F+E+U | **new** |
| K5-05 | A knowledge-content permalink (`KC:`) compares with a `KC-` prefix and appears never to match | `cdn.service.ts:888-894` | F | **new** (defect) |
| P5-01 | Popup resolves by `sourceId`; translations fall back from language to `en` to `{}` | `popup.mapper.ts:29-50` | F | **new** |

## 5. 4.x (apty-assist): conditions and their rows

### Load and widget

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| P4-01 | Top window, or the injected main frame, only | page | `main.bootstrap.ts:104-107` | P | info |
| P4-02 | OneX mode: chrome.storage `IS_APTY_ONE_X` set means no widget | Client storage | `main.bootstrap.ts:432-447` | R | "?" |
| P4-04 | Self-hosted with an installed test extension: the player aborts | chrome.management | `main.bootstrap.ts:125-128` | R | "?" |
| P4-05 | Self-hosted: the matched env's `hostedContentUrl` becomes the content URL | `app-urls.json` | `main.bootstrap.ts:139-150` | F | adapter |
| P4-06 | First app whose env URL matches. Env keys are sorted with `.map(Number).sort()`, which sorts **as strings** ("10" before "2") | `app-urls.json` | `app.helper.ts:81-87`; `injected.helpers.ts:24-49` | F+P | exists: W4X-02; **new**: string-order note |
| P4-07 | Wildcard, or raw `RegExp` when `feature-flag.json` `regExpUrl` is on | flags | `url-helpers.ts:82-105` | F+P | exists: W4X-03 |
| P4-08 | `enablePlayer` of the env matched in `app-data.json`, else env 1 | `app-data.json` | `app.helper.ts:89-109` | F+P | exists: W4X-04 |
| P4-10 | If `feature-flag.json` fails, the defaults apply: all off except `widgetSessionTracker` and `customTabOrder` | flags | `main.bootstrap.ts:75-86,365-376` | F | **new** |
| P4-11 | `widgetSSO` flag plus `tenant-config.json` `widgetSSOConfig.enabled`: needs a token; SSO failure means no player | files + token | `main.bootstrap.ts:186-197`; `sso.helpers.ts:108-150` | F (+R token) | **new** |
| P4-12 | An empty or missing `app-data.json` throws on `config.customConfig.baseTag`, giving a silent no-player | `app-data.json` | `main.bootstrap.ts:247-249,323` | F | exists: W4X-06 |
| P4-13 | `baseTag` names a tag that is not on the page: no widget | `app-data.json`, DOM | `index.tsx:186-191` | F+P | **new** |
| P4-14 | `restrictURLs` (raw `RegExp`) hides the widget **and** the flow balloons | `app-data.json` | `index.tsx:143-165,319-337` | F+P | **new** |
| P4-15 / G4-02 | Widget audience: `widgetConfig.display` All, Specific or None. Specific needs an active selected segment, or no active segment plus `enabledForOtherUser`. Segments must have loaded | `app-data.json` env `widgetConfig` | `app.selectors.ts:128-152` | F+E | exists: W4X-05 |
| P4-16 | A segment-hidden widget also stops `DOMChanged`, which frames, steps, rules and user ID depend on | — | `app.effects.ts:64-73` | F+E | **new** (inferred) |
| P4-17 | `hideAptyWidgetWhenNoContent` with empty flow, knowledge-content and aggregation lists hides the icon | flags, files | `banner.component.tsx:140-229` | F | **new** |
| P4-18 | Iframes are served only when visible, same-origin, not ignored, and not `hcmUI/afr/blank.html` | DOM | `injected.helpers.ts:66-258` | P | exists: DOM-01; **new**: ignore list |
| G4-01 | The `publishingSystem` flag picks files or the API. Off means flows never reach the flat list (`ruleVisible` unset) | flags | `tool-list.selectors.ts:50-60` | F | **new** (defect) |
| G4-04 | Locale order: stored, then `playerDefaultLocaleId`, then Workday/`<html lang>`/browser (code, alias, prefix), then `default`, then first | `langs.json`, `app-data.json`, page | `locales.effects.ts:97-148` | F+P | **new** |

### Flows

| ID | Condition | Inputs | Code | Dec. | Row |
|---|---|---|---|---|---|
| F4-01 | In env `flow.json` (no deployment filter on the files path) | `flow.json` | `flows.effects.ts:732-742` | F | exists: C4X-01/02 |
| F4-02 | Segment: in the `flows[]` of an active segment; no active segment means all | `segments.json` | `segments.selectors.ts:55-70` | F+E | exists (files); **new**: evaluated |
| F4-03 | `name[currentLocaleId]` exists | `flow.json` | `tool-list.selectors.ts:34-35` | F+P | **new** |
| F4-04 | Schedule window with `timeZone`; missing dates default to now ±2 days | `flow.json` | `announcement.helpers.ts:59-92` | F | **new** |
| F4-05 | `hideInWidget` | `flow.json` | `tool-list.component.tsx:115-123` | F | exists: C4X-03 |
| F4-06 | `attachedRule.visibilityResult` must be Show or unset (fail-open) | `rules.json` | `rule-engine.helpers.ts:45-68`; fail-open at `tool-list.selectors.ts:44-46` | R until O-3 | listed |
| F4-08 | A flow in any `tags.json` tag leaves the flat list. It shows in the group only with `clientGroupContent` and a tag name in the locale | `tags.json`, flags | `group-content.selector.ts:9-24` | F | **new** |
| F4-20 | Auto-trigger: `stepsAttachedRules[]` with `AutoTrigger`, the rule true, only the **first** eligible flow. No segment or hide check | `flow.json`, `rules.json` | `rule-engine.effects.ts:259-284` | F + R until O-3 | **new** |
| F4-21 ✔ | Frequency: daily, weekly and monthly compute `differenceInDays(last, now) >= 1`. That is never true, so the flow **auto-triggers once per user and never again**. Needs a non-default user ID | user file `autoTriggerData` | `components/app/rule-engine/rule-engine.effects.ts:298` | U | **new**: "already triggered on <date>; 4.x never repeats" |
| F4-23 | Launch: the flow exists with `name[locale]`, else the flow error modal. An empty `flow-{id}.json` cancels silently | files | `flows.effects.ts:561-617` | F | exists: C4X-06 |
| F4-26 | Announcement call-to-action: needs the name and an active segment | files | `announcements.effects.ts:359-376` | F+E | **new** |
| F4-27 | Permalink `aptyref=WF-<shortid>[-<step>]`, matched on `externalUniqueId` and needing an active segment. An unknown flow fails **silently** | URL, files | `permalinks.effects.ts:41-76`; `flows.effects.ts:678-712` | F+P | **new** |
| F4-29 | First step: the last milestone whose `formId` is an active frame, else step 0 | `flow-{id}.json`, `form.json` | `flows.effects.ts:280-302` | F+P | **new** |
| F4-30 / F4-31 | Step frame (`frames[]` / `iFramePath`) and element by type: 1 element selection, 5 jQuery, 2 custom script, 3 CSS, 4 XPath | step | `element-identification.helpers.ts:78-172` | P (types 3, 4); R until O-3 (types 1, 5) | exists: SEL-* (CSS, XPath) |
| F4-32 | Present means visible plus 6 of 9 hit points (`disablePerformHit` skips the hit test) | DOM | `element-identification.utils.ts:99-197` | P | exists: SEL-09/10 |
| F4-34 | Step condition `ELEMENT_EXISTS` / `QUERY_MATCHES` (with NOT): optional steps are skipped, required steps hidden | step | `play-flow.service.ts:342-406` | F+P | **new** |
| F4-37 / F4-38 | An optional step times out to the next one. Otherwise `customConfig.workflowWaitTime` (default 15 s) leads to the "WorkFlow Error" modal | step, `app-data.json` | `play-flow.effects.ts:264-342` | F+P | **new** |
| F4-41 | A language change aborts the running flow | page storage | `locales.effects.ts:50-69` | P | **new** |
| F4-45 / F4-46 | Resume uses session/local storage keys; `contentExpiryTime` defaults to 30 min | page storage | `storage.effects.ts:44-375` | P | **new** |
| F4-63 | User ID: `letznavId` (`localStorage['apty-user-id']`), `ApplicationID` (session), or `Custom` (segment-JS key). The default ID never loads the user file | `app-data.json` | `user-identification.effects.ts:70-163,412-436` | P / R | **new** |

### Other content types

| ID | Condition | Code | Dec. | Row |
|---|---|---|---|---|
| R4-01 / R4-02 | Frames from `form.json`: active only if every entry is Present or NotVisible. An unknown type or empty `formIdentification` is never active | `frames.reducer.ts:31-45`; `element-helpers.ts:31-34` | F (shape) + R until O-3 | **new** |
| T4-01 ✔ | Tooltip schedule: with `scheduleEnabled` and an **empty `timeZone`**, the tooltip is **hidden** | `announcement.helpers.ts:29-31,59-77` | F | **new** |
| T4-02 … T4-05 | Tooltip: `formId` active frame, element Present, rule fail-open, in the active segments' `tooltips[]` ✔ | `tooltips.selectors.ts:20-42` | F+P+E | partly exists |
| T4-06 | `hoverMessage` object: the locale's key, else key `1`, else an **empty balloon** | `publishing.helpers.ts:64-73` | F | **new** |
| L4-01 / L4-04 / L4-06 | Launcher target exists (flow with locale name, template, or knowledge content). `checkLocaleId` has **no fallback**: a string `hoverMessage` without `localeId` fails. The segments need the launcher **and** its flow or knowledge-content item | `launchers.selectors.ts:36-74`; `publishing.helpers.ts:75-85` | F+E | **new** |
| V4-01 … V4-07 | Validation: schedule (time zone defaults to Local), frame, input Present, rule, segments, indicator after interaction | `validations.selectors.ts:20-65` | F+P+E | **new** |
| A4-01 … A4-16 | Announcement: <ul><li>a permalink bypasses everything</li><li>the user's progress must be loaded</li><li>`scheduleConfig` recurrence; an invalid schedule removes it until reload</li><li>accepted / CTA / `isAlert`</li><li>goals</li><li>session dismissal</li><li>rule</li><li>frame</li><li>segments, plus `ignoreSegmentationCheck`</li><li>**all** `conditions` must hold</li><li>a busy gate</li><li>smart-canvas template</li><li>`properties[locale] \|\| [1]`, else a crash</li></ul> | `announcements.effects.ts:116-559` | F+U+P (+R) | **new** |
| O4-01 … O4-04 | Onboarding: items exist; `name[locale]`; each item's flow or knowledge-content target is published, in segment, in schedule and has a locale name. The task's **own** `segments[]` field is used | `onboarding.selector.ts:29-100` | F+E | **new** |
| K4-01 … K4-07 | Knowledge content: schedule, segments, `locales[locale]`, hide and tags. Content aggregation needs the `contentAggregation` flag | `tool-list.selectors.ts:67-77` | F+E | **new** |

## 6. Apty behaviour the Agent names as a cause

The code does these things, and an SE would not find them by hand. The
Agent names them as causes, citing the code. Each is **from code, not
runtime-verified**.

**5.x**

- The widget display is per environment, and a missing config means
  hidden (W5-08).
- One blank tooltip translation drops the tooltip in every language
  (T5-01).
- An item listed only in turned-off segments is hidden from everyone
  (W5-20).
- `visibilityRuleAction` HIDE, `environment.enableWidget` and
  `enabledForOtherUser` have no effect (G5-10, W5-22).
- Auto-trigger reads `stepsAutoTrigger`, not the workflow-level fields
  (W5-26).
- A gap in step `order` ends the run early (W5-50). One invalid step
  blocks the whole workflow (W5-41). One invalid row in `app-urls.json`
  blocks every page (W5-04).
- An announcement's `scheduleRange` is not enforced, and REPEAT has no
  end date (A5-05, A5-06).
- A knowledge-content item with no `hideFromWidget` is hidden from the
  widget (K5-01). Its permalink appears never to match (K5-05). Tags are
  not searchable (K5-10).

**4.x**

- Daily, weekly and monthly auto-trigger fires once per user and never
  repeats (F4-21).
- An unknown flow permalink fails silently (F4-27).
- With `publishingSystem` off, no flow reaches the widget list (G4-01).
- A missing `baseTag` element, or an empty `app-data.json`, means no
  widget (P4-12, P4-13).
- Environment keys sort as strings (P4-06).
- A scheduled tooltip with an empty time zone is hidden (T4-01).
- A launcher with a plain-text `hoverMessage` and no `localeId` is hidden
  (L4-04).
- An absent segment key is false, even for `not_equals` (§3.2).
- A segment-hidden widget also stalls flows (P4-16, inferred).

## 7. Keeping this true: drift and parity

This inventory has already found a check that drifted. The Agent's 5.x
widget check (`widget-not-visible.ts:365-429`) was verified at apty-dap
`4c406d5`. Since `9b2eef11` (2026-11-16) the player reads a different
field (W5-08). Three guards:

1. **Coverage manifest.** `docs/development/coverage-manifest.json` lists,
   for every condition ID:
   - its `repo:path:line` range;
   - a hash of those lines at the verified commit;
   - the check rule that covers it.

   A script runs against read-only checkouts of apty-dap and apty-assist
   at a new commit. A changed hash, or a moved or missing file, fails the
   check and lists the rules to re-verify. New files under the player's
   visibility paths are listed as "unmapped".
2. **Parity tests.**
   - For the 5.x rule evaluator (§3.1): a table of `{definition, context,
     expected}` cases taken from the player's behaviour, including every
     operator, missing values, the V8 date parse and invalid regex. They
     run in the Agent's test suite.
   - For each schema mirror: a fixture per drop cause.
3. **Real-tenant smoke test** per version on a test tenant, checking
   status and shape only. It settles the open network questions: auth on
   real hosts, timestamps, 4.x `token=` and `Referer`.

## 8. Measuring "almost always resolved, almost always right"

| Measure | Definition | Target | Source |
|---|---|---|---|
| Precision | Causes the SE marks "correct", divided by causes shown, per rule | ≥ 99%; a rule below target is demoted to "candidate" until fixed | Case record + the new SE mark |
| Resolution | Cases closed "resolved" with a cause the Agent named, divided by all cases | Tracked per symptom; the remainder is classified by blocking row | `CaseRecord` outcomes (`pilotMeasures` in agent-core) |
| Unknown share | "?" rows that decided nothing, by blocking source | Falls as §3 and open decisions O-3 / O-4 land | Checklist rows |
| Drift | Manifest hashes changed and not re-verified | 0 at release | §7 |

What can be **almost always** resolved:
- everything decided by the published files (F);
- everything decided by the page (P);
- the user's own history (U), given the user ID;
- rule and segment results built from page, storage, cookie, date, device
  and augmentation (E).

What stays "?" no matter what, and what the Agent says instead:
- `lastActivityTime`, which lives in the Client's storage;
- a stored run, stored language or Apty ID, when not on the page;
- the active-dialog state;
- customer scripts, until O-4;
- 4.x element selection and rule trees, until O-3.

For each, the row names the exact value that would decide it and how the
SE can read it in one step.

## 9. Open decisions added by this inventory

| # | Decision | Proposal |
|---|---|---|
| O-3 | Read access to `aptyInc/apty-extension-core` and `aptyInc/rules-engine-package` (4.x frames, elements, rules) | Grant read access; without it, 4.x rule and element-selection rows stay "?" |
| O-4 | Running a tenant's custom scripts (`customScript` rules, DOM_CHANGE and segment scripts, element custom scripts, `domConfig` functions) to decide a rule | Off by default; static checks (parse with the player's wrapper, references, CSP) always run without executing. If allowed: side-effect-free kinds only, in a fresh isolated world through CDP with the player's timeout (prompt WP16) |
| O-5 | Asking the SE for an Apty ID kept in Client storage | Ask once, only when a user-dependent row needs it, with one copy-paste step |
| O-6 | Fix WNV-07 now (5.x widget display per environment) | Yes: first item of the build plan, since it is wrong today |

## 10. 5.x scripts, platform and remaining features (added in v3)

Read at apty-dap `3f3adba`; paths are under `apty-dap/packages/`. The
"Docs" column records what the documents covered **before** version 3;
every row now maps to WP16 (scripts, SCR-xx) or WP17 (C-xx) of the
implementation prompt. Lines marked NOT VERIFIED or inferred need a runtime
check before a rule built on them is `active`.

### (B) Scripts in depth

**Shared runtime (applies to every row below)**

- **Interpreter.** One Sval interpreter per JS context, shared by every script in it (`libs/client/utilities/src/sval-interpreter.ts:16`).
  - It runs in the content script's **isolated world**. The DOM, localStorage and cookies are shared with the page; page JS globals are not.
  - Sval needs no `eval`, so page CSP `unsafe-eval` does not block scripts. This is my inference from the interpreter design, NOT VERIFIED.
  - jQuery is exposed as `$` through an async import that is not awaited (`:18-24`). APPLICATION_LOAD scripts that use `$` at startup may race it. NOT VERIFIED.
- **`ScriptRunner.run`** (`libs/client/utilities/src/script-runner.ts`):
  - wraps the script as the body of `async function (apty)` (`sval-interpreter.ts:40-45`);
  - caps it at 5 s; a timed-out script keeps running (`script-runner.ts:32,47-61`);
  - on failure or timeout logs `warn('Application script failed', {script, error})` under the `ScriptRunner` logger and returns `null` (`:56-57`);
  - `runAll` runs scripts in order and keeps going after a failure (`:64-68`);
  - `apty` exists only when a window channel is passed. Its single method is `apty.getWindowVar(path)` (`:19-21`).
- **Logging.** The default log level is DEBUG (`dev-mode.ts:51-56`), but Chrome hides `console.debug` unless the console shows Verbose.

| Script | Where the text lives | How and where it runs | Errors | Silent failures | Checkable without running (FILES/PAGE) | Needs running |
|---|---|---|---|---|---|---|
| **APPLICATION_LOAD** | `application-script.json[].scriptContent` where `executeOn=APPLICATION_LOAD`. Items are parsed one by one; a bad item is dropped with a warn (`libs/shared/cdn-api/src/application-environment-files.ts:169-173`; `axios-client.ts:116-140`). `scriptContent` may be empty (`contracts/.../application-script.schema.ts:66-74`) | **Top frame:** once, after every async service init and the session tracker, not awaited, **with** `apty` (`main-content-script/ioc.ts:38-49,79-87`). **Each iframe:** once, **without** `apty` (`tool-items-content-script/src/iframe/messaging/ipc.service.ts:376-378`), after the script list arrives in the load payload (`messaging/tool-items-ipc.service.ts:148-150`). Not re-run on SPA navigation. No widget-restriction or display check | Warn per script and per frame. A script calling `apty.*` throws a TypeError in **every** iframe, so expect console noise | If any init service fails, scripts never run (`ioc.ts:79` before `:87`; the catch logs at **debug**, `define-widget-content-script.tsx:81-82`). A `window.x=` assignment lands in the isolated world and the page never sees it. The return value is ignored | File present and non-empty. Parses as an async function body (acorn). Referenced `apty.getWindowVar('a.b')` paths exist in the MAIN world. Referenced selectors and storage keys exist | Side effects, exceptions, timeout |
| **DOM_CHANGE** (segment or augmentation) | Same file, `executeOn=DOM_CHANGE` (`cdn.service.ts:665-680`) | Top frame only, with `apty`, on **every** rule pass: init, DOM change, storage change, action, and every 5 s if a time-based rule exists. This happens even when the tenant has no rules (`libs/client/rules-evaluation/src/evaluation/rule-evaluation.service.ts:77-90,144-163`). Passes are serialised and queued (`player-rule-evaluation.bindings.ts:132-145`). Plain-object results are merged into the MAIN-world `window.aptyAugmentation` (`:150-176`; `window-ipc-handles.service.ts:62-75`) | Warn on failure. Warn "not a record" for other non-null results (`bindings.ts:161-169`). The whole pass is wrapped in `catch {return null}` with no log (`:182-184`) | A failing script contributes nothing, but **earlier merged keys stay** (stale values). Scripts run one after another, so N scripts can take up to 5·N s per pass. The rule wait is only 15×100 ms (W5-21), so items stay hidden at load | `window.aptyAugmentation` in the MAIN world **is** the merged output and can be read without running anything. Compare its keys with: augmentation variables in `rule.json`; `userIdentificationConfig` of type Augmentation and its `value` (`application-config.schema.ts:157-165`); segment rules | Value per script, timeout |
| **Rule `customScript` source** | `rule.json` condition `left.source='customScript'`. The **key is the script text** (`rule-evaluation-context.service.ts:110,239-252`) | Every rule pass. `ScriptRunner.run(script)` **without `apty`** in the top tool-items frame **and every ready iframe**; results are OR'ed (`tool-items-content-script/src/main/messaging/ipc.service.ts:253-266`; iframe version `:188-199`). Result is `!!` (`rule-evaluation-context.service.ts:68-70`). IPC retry is 15×(500 ms timeout, 1 s delay) (`bindings.ts:38`) | Warn "Application script failed" (misleading label). IPC failure returns `false` | A script that reads page globals gets `undefined` (isolated world, no `apty`), so the rule is false. A script that takes more than 500 ms may time out the IPC and re-run. NOT VERIFIED | Syntax. Whether it references `window.*` (always undefined in this world) or `apty` (unavailable here) | Result per frame |
| **Element type CUSTOM_SCRIPT** | Step, tooltip, launcher or validation `element.customScript` (`contracts/.../element.schema.ts:36`) | **Sync** function body (`SvalInterpreter.executeScript`), isolated world, on every element lookup including 1 s retries (`libs/client/element-identification/src/element-identification.ts:81-94`; `element-identification.service.ts:78-80`). Also runs in iframes | Warn "Script identification execution failed" | `await` is not supported. Returning a non-element: NOT VERIFIED (a Promise would break `tagName`, `element-identification.service.ts:104`). No `return` means not found, so "Step broken" | Has a `return`. No `await`. Any selectors inside resolve on the page | Returned element |
| **Launcher / CTA / Layout CUSTOM_SCRIPT** | `launcher.json` `launcherAction.script`, step CTA (`AttachedWorkflowStep.tsx:151-153`; `FloatingStep.tsx:93-94`), Layout footer and body actions, announcement actions. Non-blank is required (`shared/core/src/types/launcher.ts:50-53`) | On click, with `apty`, 5 s cap (`tool-items-ipc.service.ts:185-190,233-255`; `announcement.service.ts:189-192`). The click handler waits for the script (`await ScriptRunner.run`), but the caller then sees `undefined` either way, so success and failure look the same to it | Warn only | Click "does nothing". An announcement action counts as **completed** even when the script failed (`announcement.service.ts:189-205`). Players below 5.2.2 reject the whole file (see C-1) | Syntax, references | Effect |
| **Validation custom validator** | `validation.json` `customScriptValidator`, used when `isCustomScriptValidatorEnabled` (`tool-items-schema/src/mappers/validation.mapper.ts:89-96`) | `function(field){…}` body, **sync**, isolated world. `field = {id,value,name,element}` (`tool-items-components/src/validation/use-validators-executor.controller.ts:85-91,110-118`) | Warn "Failed executing custom script" and the field is **invalid** | `undefined` reads as invalid (`?? false`). A returned Promise is truthy, so the field is always valid (inference). An invalid regex in the REGEX validator is outside the try (`:108`), effect NOT VERIFIED | Has a `return`. Not async. Regex compiles | Result for a test value |
| **`domConfig` functions**: `screenTokenFunction`, `partialSelectorsFunction`, `ignoreSelectorId/ClassFunction` | `app-data.json` `config.domConfig.*` (`application-config.schema.ts:24-80`) | Revived as `return <src>` on **every** `getDomElement` call (`selector-config.ts:11-29`; `element-identification.service.ts:42-45,120-126`). The screen token is caught (`scope.ts:114-122`) | The revive is **not** in a try. A syntax error throws out of `getDomElement`, so element lookup of **every** type (CSS and XPath too) breaks. Caller handling NOT VERIFIED. Write-time syntax validation exists only for `screenTokenFunction` (`application-config.schema.ts:90-101,132-145`) | A screen token that throws or returns empty means the element is unguarded. A changed token hides every element captured on another screen | FILES: parse each function. PAGE: run is required to get the token | Token value |
| **Workday / Salesforce user data** | Built in, keyed on `app-data.code`. Salesforce also needs `environments[].enableUserProfile` and an optional `userProfileURL` | Before every rule pass (`bindings.ts:246-250`). Workday reads `workday.tenant`/`language`, then same-origin `GET /{tenant}/home.htmld` (`workday-user-data.service.ts:49-55,82-108`). Salesforce opens hidden `iframe#aptyFrame` to `/c/aptySalesforceIntegration.app` and parses the JSON in `[data-aura-class*="uiOutputText"]` (`salesforce-user-data.service.ts:10,23,27-69`) | Debug only (`:67`; Workday `:105-106`) | A `null` result is **cached for the page** (`user-tracking.service.ts:109-142`). If the host was not ready yet, augmentation keys (position, profile, …) stay missing until reload | FILES: `code`, `enableUserProfile`. PAGE: `iframe#aptyFrame` exists and holds the JSON; `window.workday.tenant` | — |

---

### (C) Gap table: other features

Abbreviations: F = FILES, U = USER-FILE, P = PAGE, X = EXECUTE-SCRIPT, R = RUNTIME-ONLY.

| # | Feature | Condition / edge case | Inputs | Code | What the user sees | Dec. | Docs |
|---|---|---|---|---|---|---|---|
| C-1 | Player version | Players below 5.2.2 reject a **whole** published file on an EVERY_TIME frequency or a CUSTOM_SCRIPT action. The player never reads `clientVersion` | Installed version; `environments[].clientVersion` (injected) | `libs/client/studio-components/src/helpers/player-version.helpers.ts:3-9,24-31`; `config.service.ts:28-30` | Every workflow, launcher or Layout in the env disappears | P (injected: version in `iframeLocalStorageURL`, `player-config.example.json`) / R (extension) | no |
| C-2 | User identity | An external ID that is missing or not a string **silently falls back to the Apty ID**. The Apty ID is stored per **app+env** in extension storage, but the user file is per **app** | `config.userIdentificationConfig`; page storage and augmentation | `user-tracking.service.ts:46-76,153-172`; `local-storage.service.ts:126-129` | Completions, favourites, auto-trigger and announcement history "forgotten" or differ by env, browser or profile | F+P | partly: "ask once"; fallback and scoping missing |
| C-3 | User-file writes | `post` never throws, so a failed write (storage API 4xx/5xx, CORS) is invisible and the rollback is dead code. The cache keeps the new value for 2.5 s | `storageURL` | `axios-client.ts:143-157`; `user-preference.service.ts:40-58`; `cdn-reader-api.service.ts:83-106` | Favourite, feedback, reminder or announcement "accept" reverts after reload; items "show again" | R (+U: compare file with what the user did) | no |
| C-4 | User file read | A schema failure **or** network error returns `EMPTY_USER_PREFERENCE`, and the next write overwrites the stored file with it | `users/{uid}.json` | `cdn-api/.../cdn-reader-api.ts:86-98`; `application-environment-files.ts:216-222`; `user-preference.service.ts:40-46` | Permanent loss of all progress | U | partly (G5-22): the overwrite is missing |
| C-5 | Content freshness | Every file is cached in memory for the page's lifetime | — | `cdn.service.ts:90-104` | "Published but not showing" until a full reload, especially in SPAs | R | no |
| C-6 | Self-hosted 5.x | User preferences live in browser storage, not `users/{uid}.json`. Session tracking and analytics are off. AI is forced off | `player-config.isSelfHosted` | `cdn-reader-api.service.ts:52-62,83-88`; `session-tracker/ioc.ts:19`; `analytics.service.ts:99` | U-based checks give wrong answers | P (config) | partly: only AI covered |
| C-7 | Extension host access | `host_permissions` covers only `https://*.apty.ai/*`. Background fetches to any other `contentURL`, `storageURL` or `aiBackendURL` need CORS | `player-config.json` URLs | `wxt.config.ts` manifest (`host_permissions`); `background-script-ipc.service.ts:98-219` | No content, no saves, no AI | P (config hosts) | no |
| C-8 | Extension presence | Site access set to "on click" or restricted by policy; `file://` URLs; dev and store builds both enabled (two widgets); extension updated while the tab is open ("context invalidated", inferred Chrome behaviour, NOT VERIFIED) | Browser | `wxt.config.ts` (comment on dev and store builds; `content_scripts`) | No widget, two widgets, or features failing until reload | P (absence of `window-script.js` and `apty-widget`) / R | no |
| C-9 | Window-script death | The host breaks the MAIN-world script (CS-3090). The fallback reads window variables as `undefined` and merges augmentation into the isolated world | Page | `messaging/window-ipc.service.ts:26-31,104-131` | Window-variable rules false, external ID falls back to the Apty ID, `apty.getWindowVar` undefined | P (MAIN `aptyAugmentation` absent while the widget is present) | no |
| C-10 | Startup failure visibility | Any init error is logged at **debug** | — | `define-widget-content-script.tsx:81-82` | No widget, nothing in the default console | R | partly (G5-05) |
| C-11 | Reminders | Only future reminders are scheduled at load: past-due ones never fire. Skipped on a restricted URL and not retried. A delay above 2^31-1 ms (~24.8 days) fires immediately (browser behaviour, NOT VERIFIED). One timer per open tab | `users/{uid}.json` `reminders[]`; `features.reminders` | `reminder-scheduler.service.ts:35-84` | Missed, duplicate or early reminders | U+F | partly: tab flag only |
| C-12 | Favourites | Written to the user file (C-3 applies). Optimistic UI rollback only on a throw, which never happens | user file `favorites` | `user-help-preference.controller.ts:14-40` | Favourite lost after reload | U | no |
| C-13 | Checklist tab | Hidden when there are no visible checklist items | — | `WidgetTabBar.tsx:47-54` | "Checklist tab missing" | F+X | partly |
| C-14 | Autopilot | No list button (commented out). Only `aptyref`+`autopilot=true`, and only if the workflow has `enableAutopilot` | URL | `widget/content/help/FlowItem.tsx:24-40`; `workflow-engine.service.ts:514`; `permalink.service.ts:76-87` | "No autopilot option" | F+P | partly |
| C-15 | Permalinks | The key is matched case-insensitively and also inside nested query values (SSO RelayState), but removal deletes only the exact `aptyref`. `autopilot` is read only from the first `?`. Parsed only at first load (`window.location.href` at IoC time). Unknown type is logged as an error | URL | `permalink.service.ts:37-73,76-87,94-125,128-138`; `ioc.ts:67` | Link ignored after SSO or SPA navigation | P | partly (W5-38/A5-08/K5-05) |
| C-16 | Dev mode (debug aid) | `localStorage.apty_player_dev_mode='true'` shows the User ID, connected segments and true rules in Settings. `apty_player_log_level` sets the level. "Clear" resets progress. The shadow root is `open` | Page localStorage | `dev-mode/dev-mode.ts:3-56`; `DevModeSection.tsx:35-120`; `dev-mode.service.ts:33-50`; `utilities/src/dom/shadow-dom.ts:20` | — (Agent could read the User ID without asking the SE, O-5) | P | no |
| C-17 | Injected storage | The storage iframe is third-party, so browser storage partitioning likely gives a different Apty ID per host site (NOT VERIFIED). A rejected iframe load has no catch, so the widget never starts | `iframeLocalStorageURL` | `index-injected.tsx:13-43,62-70` | Progress differs per site; no widget | P | partly (W5-02) |
| C-18 | App properties | Read but ineffective: `maxZIndex` (no reader), `workflowWaitTime` (mapped only), `baseTag` (forced BODY), `queryShadowDOMAsFallback` (forced false). Effective but not covered: `ignoreDomChangeConditions` and `domDebounceTime` (DOM changes ignored, so rules and steps don't re-evaluate), `enableShadowDOMSupport` (shadow-DOM mutations not observed), `enableFocusLock` | `app-data` `domConfig`, `widgetConfig.workflow` | `tool-items-schema/src/mappers/application.mapper.ts:46-55`; `dom-change-config.service.ts:19-21`; `FlowsFocusTrap.tsx:15-16` | Stuck steps, keyboard trapped | F | partly (G5-10 style) |
| C-19 | Knowledge content media | URL opens via `window.open` and is popup-blocked when the call is not in a user gesture (permalink, announcement). Video uses a YouTube/Vimeo iframe or `<video>`; documents use DocViewer (PDF worker, MS Office iframe). Host CSP or X-Frame-Options can blank them (NOT VERIFIED) | Item; page CSP | `browser.service.ts`; `knowledge-content.service.ts:95-96`; `tool-items-components/src/media/Renderers.tsx:99-116`; `DocViewer.tsx:128-134` | Nothing opens, or an empty viewer | P | no |
| C-20 | Ask Dapty history | Chats stored at `{chat dir}/{userId}/…` through the storage API, read back from the CDN. Keyed on the user ID, so C-2 and C-3 apply | — | `widget/ai-chat/widget-chat-storage.service.ts:30-31,104-200` | History lost or different | R | partly |
| C-21 | Fonts / themes | `fontsURL` is injected, so a page CSP `font-src` falls back to system fonts. Long-press NeedHelp vs star launcher is chosen by `theme.widget.needHelp.enabled` | config, theme | `themes.service.ts:29-38`; `ClosedWidget.tsx:24` | Cosmetic, "launcher looks different" | F+P | no |
| C-22 | Widget position | Per-user, per-app+env position stored in extension storage. Clamped during drag; clamping on restore NOT VERIFIED | Client storage | `use-widget-position.controller.ts:22-43`; `local-storage.service.ts:85-88` | Widget "moved" or off-screen | R | no |
| C-23 | Baseline journey | Analytics only (30-min inactivity), no UI | `baseline-journey` file | `baseline-journey.service.ts:37-60,501` | none | — | n/a |
| C-24 | Analytics | Failures are logged, nothing visible. Self-hosted returns early | — | `analytics.service.ts:96-130` | none | — | n/a |
| C-25 | Rule pass blocked by a regex | Covered in docs §3 (an invalid regex fails the pass) | — | — | — | — | yes |

## 11. 4.x feature flags, scripts and platform (added in v3)

Read at apty-assist `bbb4cbc`; paths are under `player3.0/src/` unless
shown. Every row maps to WP16 (SCR-xx) or WP17 (D-xx).

### (B) Feature flags

The flags are defined in `components/Technical/feature-flag/feature-flag.types.ts:95-260`, not `shared/types`.

How the flag file is read:
- **Extension bootstrap.** It is merged one level deep over the defaults (`main.bootstrap.ts:75-86,365-376`).
- **Injected loader.** It is read **unmerged** (`inject/config.ts:74-80`). If the file has no `selfHosted` key, or the request fails (`xhr.onerror` resolves `''`, `inject/config.ts:51`), `featureFlags.selfHosted.status` throws and there is no player (inferred).
- **Frame services.** They read flags by key name through `featureFlagsService.flags` (`services/feature-flags.service.ts:10-15`).

| Flag (key) | Default | Gates | Read at | Docs |
|---|---|---|---|---|
| URLRegex | false | nothing (no reader found) | — | no |
| LSP10544-PublishingSystem | false | Files vs legacy API for every content type; also whether `tenant-config.json` is fetched in injected mode | `inject/config.ts:88`; `resolver.effects.ts:185`; `flows.effects.ts:165-170`; `badges.effects.ts:49`; `themes-v2.effects.ts:95`; `tool-list.selectors.ts:28` | partly (G4-01 covers only the flow list) |
| LSP11470-ErrorInsightsConfig | false | Customer error-detection scripts. Dead: `getApplicationStoredConfig` is never given the flag (`gazer/segmentation/app-configuration.ts:88-108`; callers `gazer/effects/segmentation/effects.ts:24`, `user-identification.effects.ts:129`) | `feature-flag.selector.ts:24` (not used) | no |
| DisableInsightsAnalytics | false | Gazer services | `services/services.bootstrap.ts:84` | no |
| DisableAssistAnalytics | false | Analytics events | `analytics.effects.ts:62-66` | no |
| ThirdPartyAnalytics | false | Customer analytics endpoint | `analytics.effects.ts:105` | no |
| DetectLocaleOnDomChange | false | Re-detects the locale on every DOM change | `locales.effects.ts:150-157` | no |
| ClientVersion | `APTY_CLIENT_VERSION` (a string) | Injected bundle path and compatibility mode | `isolation.helpers.ts:51-55` | no (P4-10 says "all off") |
| DisableServerCalls | false | nothing found | — | no |
| LSP12255-InvokeStepAfterFramesUpdate | false | Replays a milestone step after a frame update | `frames.effects.ts:233-246` | no |
| LSP-12103-Draggable-Player | false | Draggable launcher icon | `banner.component.tsx:141` | no |
| LSP12158-ZindexAppConfig | false | nothing found | — | no |
| LSP12403-enableFrameCheck | false | nothing (selector unused) | `feature-flag.selector.ts:54` | no |
| CB454-IgnoreSegmentationCheck | false | Announcement segment bypass | `announcements.effects.ts:119` | yes (A4) |
| SelfHosted | false | Turns off systemConfig, the user file, activities, the session tracker and analytics; changes the bundle path | `main.bootstrap.ts:220`; `user-identification.effects.ts:416-422`; `activities.effects.ts:112-117`; `services.bootstrap.ts:88`; `isolation.helpers.ts:56` | partly (only the content URL) |
| LSP12645-BrokenWorkflowRecovery | false | Broken-step widget instead of ending the flow | `flows.effects.ts:245,269`; `broken-step-widget.component.tsx:308,422` | no |
| LSP12622-EnhancedActivities | false | Loads and logs activities | `resolver.effects.ts:140-143`; `activities.effects.ts:113-117` | no |
| AptyBranding | false | Branding in footer, KC modal and broken widget | `brand.tsx:27` and others | no |
| WhiteLabeling | false | nothing found | — | no |
| ClientMostUsedContent | false | Loads `most-used-content.json` | `group-content.effects.ts:28` | no |
| ClientFavoriteContent | false | Favorites | `tool-list.selectors.ts:102-107` | no |
| ClientGroupContent | false | Loads `tags.json` at all | `group-content.effects.ts:52-56` | partly (F4-08, see D) |
| CB684-WFAutoScrollBehaviour | false | Step auto-scroll | `play-flow.effects.ts:639` | no |
| LSP14236-HideAptyWidgetWhenNoContent | false | Hides the icon | `banner.component.tsx:204-206` | yes (P4-17) |
| LSP15462-CustomValidationIcon | false | Validation icon | `validation.component.tsx:195` | no |
| DomChangeDebounce | false | DOM-change debounce from `customConfig` | `app.effects.ts:95-97`; `dom-tracking.service.ts:201` | no |
| AptyElementSelect / AptyElementSelectTest | false | Dynamic element search (extension-core); Test logs "DES" to the console | `element-identification.helpers.ts:270-282`; `play-flow.service.ts:206` | no (5.x notes it; 4.x does not) |
| RegExpURL | false | Raw RegExp env matching | `main.bootstrap.ts:210,300,326` | yes (P4-07) |
| EventsAPI | false | Event gateway config fetch | `main.bootstrap.ts:200`; `common-store-utils.ts:87` | no |
| LSP17880-InHouseFeatureFlags | false | nothing found | — | no |
| ShadowRootsPlayer | false | Shadow-DOM fallback, **injected mode only** | `element-identification.helpers.ts:125,283` | no |
| WidgetSessionTracker | **true** | Session tracker | `services.bootstrap.ts:88` | yes (default only) |
| LSP21281-EndWorkflowOnBrowserClose | false | No resume after a browser or tab close | `play-flow.effects.ts:673-678`; `index.tsx:340-342` | no |
| LSP20085-ContentAnalytics | false | nothing (selector unused) | — | no |
| SendAnalyticsToProxyService | false | Analytics route | `analytics.effects.ts:64` | no |
| ContentAggregation | false | Content aggregation | `resolver.effects.ts:136` | yes (K4) |
| CustomTabOrder | **true** | Tab order in balloons and launchers | `launchers.component.tsx:236`; `play-flow.component.tsx:824` | yes (default only) |
| IgnoreDuplicateBadgeDisplayEventsInASession | false | Analytics dedupe | `analytics.effects.ts:101` | no |
| Pulse | false | Pulse-only mode, when combined with `pulseConfig.isEnabled` and the env | `main.bootstrap.ts:328-331` | **no** |
| WidgetSSO | false | SSO gate | `main.bootstrap.ts:187` | yes (P4-11) |

### (C) Scripts in depth

**Three things apply to every script below:**
- **Engine.** `newFunction` and `evalJS` are the **Sval interpreter**, not native `eval` (`shared/helpers/deserialize.helpers.ts:10-52`). It needs no `unsafe-eval` and runs in the realm where Apty code runs: the content-script isolated world in extension mode (inferred).
- **Page variables are invisible in extension mode.** The code itself says "Window var accessed only in Injected Mode" (`gazer/segmentation/app-helpers/workday.ts:16`).
- **Errors are invisible in production.** `letzConsole` logs only when `NODE_ENV==='development'` (`shared/helpers/letzconsole.ts:1-5`), so in production it prints nothing.

| Script | Lives in | How and where it runs | Errors | CSP | Silent failures | Checkable without running / with running |
|---|---|---|---|---|---|---|
| **segment-js.js** | `tenant-X/app-Y/env-Z/segment-js.js`. Fetched twice: at bootstrap with the content-config timestamp (`main.bootstrap.ts:211-218`) and in the resolver (`resolver.effects.ts:104-114`, kept as `config.customConfig.segmentAdvancedJS`). The background blanks it only if the body is the `{"message":"No data found","status":404}` JSON (`background-scripts/send-request.ts:68-86`) | **Extension:** posts `EXECUTE_ADVANCED_JS` to `window.top` (`segments.helpers.ts:54-62`). `window.var.js` (page MAIN world) runs `new Function(code)()` (`window.var.js:15-53,89-92`). If that throws, it awaits `executeAptySegmentationScript`, an inline `<script>` added earlier through `CREATE_SEGMENT_SCRIPT` (`window.var.js:65-77`; `index.tsx:346`). **Injected:** Sval in the Apty frame (`segments.helpers.ts:42-53`). The result goes into `window.__APTY_ADVANCED_JS_DATA__`, exposed as `application_customData` (`common-store-utils.ts:56-63,98-101`). Re-run on every `DOMChangedInAWindow`, debounced 500 ms (`advanced-js.effects.ts:15-18`; `constants.ts:29`) | `console.warn` only on the fallback path; otherwise the result is `{}` | Extension mode needs page `unsafe-eval`; the fallback needs inline scripts allowed. Injected mode needs neither | 1. A non-object return gives `{}`. 2. An **async** script returns a Promise; `postMessage` throws DataCloneError, so only the inline fallback can succeed. 3. A non-cloneable result (DOM node, function) throws in `finally` too, so no reply at all (inferred). 4. An XML 403/404 body is run as JS. 5. **If `window.var.js` never replies and no segment matches, the resolver never finishes and the UI never renders** (see D-01) | Without running: fetch the file, check it is not empty, not the 404 JSON or XML, parses, and whether it is `async`. Probe the page CSP for `unsafe-eval` and inline scripts. List the `application_customData.*` keys the segments use. With running: the actual customData and the segment result |
| **custom-js.js** (app-level script) | Same folder; resolver `appDataCDN.script` (`resolver.effects.ts:105,112`). Also re-fetched for app 1, env 1 as the SSO token probe (`api/backend.ts:634-637`; `sso.helpers.ts:120-127`) | Sent to every frame's ScriptExecutionService (`components/app/script-execution/script-execution.effects.ts:79-87,103`). Runs **once per frame per page load** (`services/script-execution.service.ts:14-21`) through Sval with `'use strict'` and `letzNavApi.sendUserAction(code6, data)` (`letznav-api.helpers.ts:11-31,71-83`) | `console.warn('API Script execution error')` | No CSP need in extension mode | It cannot see page globals in extension mode (inferred). `sendUserAction` throws unless the code is 6 alphanumerics. A missing file served as an XML error body is run and warns (a red herring) | Without running: fetch, parse, look for page-global references and `sendUserAction` codes. With running: whether its DOM side effects happen |
| **custom-css.css** | Same folder; resolver `theme.advancedThemeCSS` (`resolver.effects.ts:107-109`). Not validated in the background (`send-request.ts:11,83-85`) | Added as `<style id="apty-custom-css">` to **every frame's page `<head>`**, from common services, so even when `loadPlayer` is false (`services/custom-theme.service.ts:27-37`; `common-services.ts:27`). In injected mode it goes into the Apty frame, unsanitized (`custom-theme.effects.ts:18-29`) | none | Page `style-src` without `unsafe-inline` blocks it (inferred) | The text passes through `DOMPurify.sanitize` (`common-helpers.ts:28-33`), so a CSS `>` likely becomes `&gt;` and child-combinator rules break in extension mode (inferred, NOT VERIFIED). It is inserted once and never updated. A 404 body becomes the CSS | Without running: fetch, look for `>`, `&` or `<`, probe CSP, check `#apty-custom-css` exists in the DOM |
| **Theme customCSS (themes v2)** | `themes.json` theme `customCSS` | style-it wrapper around the widget, flows, KC modal and balloons (`custom-css.component.tsx:9-17`; `App.tsx:132`; `play-flow.component.tsx:565`) | none | in-React style | — | files |
| **`window.var.js` protocol** | Extension web-accessible file, added only outside injected mode, after app match and SSO (`main.bootstrap.ts:203-207`; `react.element.helper.ts:7-24`) | Listens on `window.top` (capture). Messages: `get_letznav_global_variables` (dotted window path), `EXECUTE_ADVANCED_JS`, `request_gazer_session_workday`, `CREATE_SEGMENT_SCRIPT`, `set_window_varaible`, `TRACK_SPA_PAGE_CHANGES` (patches pushState and replaceState for Pulse) (`window.var.js:1-114`) | none | Script load from `chrome-extension://` under page CSP: NOT VERIFIED | **No request IDs**, so concurrent window-variable reads can get the wrong answer (`rules-context-builder.service.ts:140`). The reads have **no timeout**, so a missing `window.var.js` hangs rule evaluation (`rule-engine.service.ts:299-311`). The value must be cloneable | PAGE: is `window.var.js` in the resource entries; `window.top` reachable |
| **step.script** (workflow step) | `flow-{id}.json` step `script` | `executeStepScript` on every step received, in the frame matching the step (FLOATING means top only) (`services/play-flow.service.ts:285-318,408-419`), through Sval with `letzNavApi.flow.next/back/goto/end/fail/pauseFlow` (`letznav-api.helpers.ts:33-69`). `goto(n)` is 1-based and counts **non-decision steps only** (`play-flow.effects.ts:605-613`). pauseFlow hides the step | `console.warn` | none in extension mode | It can run more than once per step (on re-request) (inferred). In injected mode the Sval realm is the Apty frame, so `document` may be wrong (NOT VERIFIED) | files: show the script and the API calls it makes |
| **customScript element (type 2)** | Step, tooltip, validation or launcher `customScript` | `executeScript`: **extension mode uses Sval; injected mode uses the page's `window.parent.Function(script)()`** (`element-helpers.ts:38-57`). The result must be an element with a rect (`element-identification.helpers.ts:29-41,106-108`) | `console.warn` | **Injected mode needs page `unsafe-eval`** | Returning a jQuery object or a selector string gives "not found" | Without running: static checks (return type). With running: whether an element comes back |
| **Rules customScriptPool** (visibility, auto-trigger, announcement conditions) | `rules.json` `ruleContextPool.customScriptPool[k].script` | `!!result`; Sval in extension mode, page `Function` in injected mode (`rule-engine.service.ts:234-271`) | `console.error`, result false | Injected mode needs `unsafe-eval` | An **async script is always true** (`!!Promise`). A throw gives false | Without running: show it and flag `async` or `await` |
| **Decision-point scripts** (legacy rules) | Step `decisionPoint.rules` | rules-context-builder, **top frame only** (`rules-context-builder.service.ts:181-215`). Result within 2 s, else the flow **silently moves to the next step** (`play-flow.effects.ts:237-247`; `constants.ts:103`). New-engine rule timeout is `decisionPoint.timeOut*1000 \|\| 2000` (`play-flow.effects.ts:194-201`) | `console.error` | same as above | Wrong branch on timeout | files + PAGE |
| **Custom validators** | `validation.json` validator `{type: Custom, code}` | `newFunction('field','context',code)` in the main player window. `newFunction` is **outside** the try, so a syntax error escapes to the saga catch, then `letzConsole` (silent) (`element-helpers.ts:273-286`; `validations.effects.ts:201-207`). An invalid Regex validator throws the same way (`element-helpers.ts:259-260`) | silent in production | none | The validation indicator never updates | Without running: parse the code and compile the regexes. With running: the validator result |
| **Smart-canvas template** | `smart-canvas-templates.json` `templateHTML` | `innerHTML` into an open shadow root, so `<script>` does not run (`smart-canvas-template.component.tsx:30-34`). Clicks count only if `e.target.tagName==='BUTTON'` (a click on a child `<span>` does nothing). Launcher buttons need `data-launch-content` and `data-flow-id` **and** `data-step-id`, or `data-kc-id` (`:39-62`). Announcement CTAs come from button `id` and `data-action` (`announcements.effects.ts:504-546,553-558`) | none | Inline `on*` handlers fall under page CSP (inferred) | Buttons without `id` or `data-*` do nothing. A missing template hides the launcher (`launchers.selectors.ts:35-41`) | FILES: parse the HTML and list the buttons and their data attributes |
| **JSONPath segment keys** | `segments.json` `conditions[][].key` | `jsonPath(META, "$[key]")`. Keys `(...)` and `?(...)` run through Sval `evalJS` (`segment-executor.helpers.ts:60-70,117-125,166-179`). **`*` and `..` over arrays are broken**: `walk` visits index i only if `val.indexOf(i) > 0` (`:79-84`) | `letzConsole`, result false | none | Wildcard paths over arrays never match | FILES: flag array wildcards |
| **Activity augmentation scripts** | `activities.json` `augmentationScript[].customJS` | `executeScript`, same split as the customScript element (`activities.helper.ts:137-157`) | `console.warn` | Injected mode needs `unsafe-eval` | — | files |

### (D) Gap table

The "Decidable by" column uses five labels: FILES (from content files), USER-FILE (from the user's progress file), PAGE (from the live page), EXECUTE-SCRIPT (only by running the customer's script), and RUNTIME-ONLY (only by watching the running player).

| # | Feature | Condition or edge case | Inputs | Code | What the user sees | Decidable by | Docs cover? |
|---|---|---|---|---|---|---|---|
| D-01 | Resolver gate | The UI renders only after `UPDATE_ACTIVE_SEGMENTS`. With no active segment, that fires only after the segment-JS reply. No reply means the loader never clears: nothing renders and no flow resumes | `window.var.js` load, CSP, cloneable result | `resolver.tsx:20`; `resolver.effects.ts:60-71,160-171`; `segments.effects.ts:58-71`; `advanced-js.effects.ts:20-26` | No widget, tooltips or launchers; no error | PAGE (+RUNTIME) | no |
| D-02 | segment-js engine | Extension mode needs page `unsafe-eval` (fallback: inline script); injected mode needs neither. Async, non-object and non-cloneable results | segment-js, CSP | `window.var.js:15-53,89-92`; `segments.helpers.ts:41-63` | Segments wrong; customData empty | FILES+PAGE / EXECUTE-SCRIPT | partly ("?" only) |
| D-03 | Segment `WINDOW_VARIABLE` | Read with `window.top[k]` from the content script. In extension mode page globals are probably undefined, while the Agent's MAIN-world reader would see them | `segments.json` | `localstorage.helper.ts:33-49`; `workday.ts:16` | Segment never active | PAGE (inferred) | no; WP5 reads MAIN world, so it may disagree with the player |
| D-04 | `application_data` segment keys | Gazer app session (Workday, Salesforce, PPM) is merged into the segment metadata; 10 s timeout | app type, Workday cookie | `segments.effects.ts:49-53,65-67`; `gazer/effects/segmentation/effects.ts:19-31`; `config.helpers.ts:7-32` | Segment wrong on Workday | RUNTIME-ONLY | no |
| D-05 | JSONPath arrays | `*` and `..` on arrays never match | segment key | `segment-executor.helpers.ts:79-84` | Segment false | FILES | no |
| D-06 | Rule window-variable read | No timeout and no request ID. A falsy value is treated as absent | page | `rule-engine.service.ts:274-311`; `rules-context-builder.service.ts:135-148,244-268` | Rule stuck or wrong | PAGE | no |
| D-07 | Rule customScript | Async gives true; a throw gives false; injected mode needs `unsafe-eval` | `rules.json` | `rule-engine.service.ts:234-271` | Wrong visibility or auto-trigger | FILES / EXECUTE-SCRIPT | partly ("?") |
| D-08 | Decision points | Two engines; 2 s timeout then next step; legacy scripts top frame only | step | `play-flow.effects.ts:194-248`; `rules-context-builder.service.ts:186` | "Wrong branch" | FILES+PAGE | no (symptom listed only) |
| D-09 | step.script | Flow-control API; goto skips decision steps; pauseFlow hides the step | step | `play-flow.service.ts:408-419`; `play-flow.effects.ts:593-630` | Jumps, ends, pauses | FILES | no |
| D-10 | custom-js.js | Runs once per frame in Sval; page globals invisible; also used as the SSO probe | file | `script-execution.service.ts:14-21`; `letznav-api.helpers.ts:71-83` | Customer behaviour missing | FILES (+EXECUTE) | no |
| D-11 | custom-css.css | Inline `<style>` in every frame; DOMPurify may mangle `>`; CSP; never updated | file, CSP | `custom-theme.service.ts:27-37`; `common-helpers.ts:28-33` | Styling not applied | FILES+PAGE | no |
| D-12 | Custom and regex validators | A syntax error or invalid regex throws outside the try; silent | `validation.json` | `element-helpers.ts:259-286` | Validation never updates | FILES | no (V4 has no validator rows) |
| D-13 | customScript element in injected mode | Uses page `Function`, so page `unsafe-eval` is needed | step or tool | `element-helpers.ts:44-49` | Element "not found" | PAGE (CSP) | partly ("?") |
| D-14 | Smart canvas | BUTTON-only click target; launcher needs flowId **and** stepId; CTA by button `id` | template HTML | `smart-canvas-template.component.tsx:39-64`; `announcements.effects.ts:504-546` | Button does nothing | FILES | partly (A4 notes only that the template exists) |
| D-15 | `letzConsole` | No output in production; hides bootstrap, CDN, segment, permalink and validation errors | — | `letzconsole.ts:1-5`; `main.bootstrap.ts:247-249` | Console clean, player absent | — (tell the SE) | no |
| D-16 | Pulse-only mode | `enablePlayer` false plus Pulse: renders the resolver with no UI; `window.top.letznavPlayerLoaded`-style flag set; SPA history patched | `feature-flag.json`, `app-data.json` `pulseConfig`, env | `main.bootstrap.ts:227-229,328-331`; `index.tsx:209-216,299-302` | Apty seems loaded but there is no widget | FILES | no |
| D-17 | OneX | Starts only on the `startAptyPlayer` runtime message; with OneX on there is **no player at all** (tools included) until that message | chrome.storage | `main.bootstrap.ts:432-447` | Nothing | RUNTIME-ONLY | partly (says "no widget" only) |
| D-18 | Firefox MV2 | No `storage` permission, but `main()` calls `chrome.storage.local.get`; the TypeError is caught, so no player | manifest | `manifests/manifest-firefox.json:12-19`; `main.bootstrap.ts:435`; `chrome-storage.helpers.ts:5-8` | No player on Firefox (NOT VERIFIED) | FILES | no |
| D-19 | Test-extension abort | The manifest has no `management` permission, so the lookup returns null and the abort likely never fires | manifest | `extension-management.helpers.ts:1-13`; `manifest.json:13` | — | FILES | P4-04 may describe dead code |
| D-20 | Self-hosted content host | MV3 `host_permissions` covers only `*.apty.io` and localhost; a customer `hostedContentUrl` needs CORS from the service worker; errors fall back silently | `app-urls.json` | `manifest.json:12`; `http.ts:247-277`; `send-request.ts:77-110` | Empty content | FILES+PAGE | partly (D-SELFHOSTED covers Agent policy, not player failure) |
| D-21 | Self-hosted side effects | No user file (auto-trigger and completion unknown), no activities, no session tracker, no systemConfig | flag | `user-identification.effects.ts:416-422`; `activities.effects.ts:112-117`; `services.bootstrap.ts:88` | Repeats, no progress | FILES | no |
| D-22 | Injected loader CSP | The isolation iframe flags itself with an inline `<script>` through `document.write`, so page CSP without inline scripts means no player | page CSP | `inject/elements.ts:51-53` | No player (inferred) | PAGE | no |
| D-23 | Injected config cache | Flags, clientVersion and staticFilesPath are cached for 1 h in localStorage `apty_config` | localStorage | `inject/config.ts:97,113-121` | Flag change "not taking effect" | PAGE | no |
| D-24 | Injected boolean attributes | `Boolean(getAttribute('data-self-hosted'))`, so the string "false" counts as true; same for `data-reg-exp-url` | `#letznav-script` | `injected.helpers.ts:356-358` | Wrong content host or matching | PAGE | no (WP2 probe reads these attributes) |
| D-25 | clientVersion selection | The snippet sorts env keys numerically with its own wildcard regex (unlike the player); falls back to `4.16.0`; template line 169 lacks a `/` | `app-urls.json` | `inject-template.js:86-97,165-169`; `isolation.helpers.ts:48-74` | Old or missing bundle | FILES+PAGE | no |
| D-26 | CDN fetch semantics | `x-referer` header (not Referer), `keepalive`, `?token=`; JSON errors and 404 become fallback `[]` or `{}`; a 401 is returned as content | — | `send-request.ts:14-34,77-110`; `http.ts:279-285`; `common-helpers.ts:90-95` | "Content missing" | FILES | partly (`token=`/Referer only) |
| D-27 | SSO blocking | Up to 5 retries 60 s apart before bootstrap continues; prompt or popup can be blocked | `tenant-config.json` | `sso.helpers.ts:18-19,84-100,113-170` | Player appears minutes later or never | FILES+RUNTIME | partly |
| D-28 | Legacy `/assist` path (publishing off) | Steps, badges, themes, locales and translations come from APIs with a deployment filter (Published, plus Ready off-prod); files do not apply | flags, env | `flows.effects.ts:165-170`; `badges.effects.ts:47-70`; `publish-filter.helpers.ts:5-31`; `resolver.effects.ts:185-207` | Anything | FILES (flag) | partly (G4-01 only) |
| D-29 | Tags and grouping | `tags.json` loads only with `ClientGroupContent`, so with the flag off the F4-08 removal cannot apply (NOT VERIFIED where the removal happens) | flag | `group-content.effects.ts:50-61` | — | FILES | F4-08 may be inaccurate |
| D-30 | Most used, favorites | Each gated by its own flag; favorites come from the user file | flags, user file | `group-content.effects.ts:26-37`; `tool-list.selectors.ts:102-107` | Section missing | FILES+USER-FILE | no |
| D-31 | Search and keywords | Needs 2+ characters; keywords need a locale name (publishing) | `keywords.json` | `searchHelper.ts:96-115`; `keywords.selector.ts:7-21` | Item not found by search | FILES | no |
| D-32 | KC and AN permalinks; `letznavref` | Prefixes WF, KC and AN; key matched by **substring** of `aptyref` or `letznavref`; only `aptyref` is removed from the URL. KC is matched on `externalUniqueId` against all KC with no segment check, unknown gives an error modal. WF: `selectedFlow.id` is read before the null check, so a crash (silent). Step permalink ignores autopilot; unknown step plays nothing but is marked played | URL | `url-helpers.ts:16-47`; `permalinks.effects.ts:41-77`; `custom-content.effects.ts:59-80`; `flows.effects.ts:686-702` | Nothing, or error modal | FILES+PAGE | partly (WF only) |
| D-33 | Autopilot | `autopilot=true`; per-step advance types; dropdown fallback | step | `play-flow.effects.ts:770-812` | Autopilot does not act | FILES | no |
| D-34 | Broken-step widget | With `BrokenWorkflowRecovery` the flow is not nulled and the widget shows (with screenshot) instead of the "WorkFlow Error" modal | flag | `flows.effects.ts:245-247,266-273`; `broken-step-widget.component.tsx:289-308` | Different error UI | FILES | no (F4-38 names only the modal) |
| D-35 | EndWorkflowOnBrowserClose | Resume suppressed via chrome.storage and tab tracking | flag + flow field | `play-flow.effects.ts:667-690`; `background-scripts/helpers/storage.helpers.ts:92-136` | Flow does not resume | FILES | no |
| D-36 | Activities and goals | Flag; self-hosted off; augmentation scripts; rules via rules-engine; progress in localStorage | `activities.json` | `activities.effects.ts:110-130`; `activities.helper.ts:124-170` | Activity not completing | FILES+PAGE | no |
| D-37 | ShadowRoots and DynamicSelect | Shadow fallback only in injected mode; dynamic search only by flag | flags | `element-identification.helpers.ts:254-287` | Element in shadow DOM not found (extension) | FILES+PAGE | no |
| D-38 | Custom user ID | `Custom` reads a **top-level** key of the segment-JS result only, so it depends on the segment-JS reply | `app-data.json` | `user-identification.effects.ts:131-134,147-148` | Default ID, so no user file | EXECUTE-SCRIPT | partly (F4-63) |
| D-39 | DetectLocaleOnDomChange, InvokeStepAfterFramesUpdate, DomChangeDebounce | Behaviour flags not modelled | flags | `locales.effects.ts:150-157`; `frames.effects.ts:233-246`; `app.effects.ts:95-97` | Locale flips; step replays; lag | FILES | no |
| D-40 | Fonts and themes v2 | Themes from file or API; fonts from `fontsUrl` (self-hosted `/fonts`) | `themes.json` | `themes-v2.effects.ts:94-100`; `main.bootstrap.ts:147`; `fonts.helper.ts:27-32` | Unstyled balloons | FILES | no |
| D-41 | P4-10 accuracy | Defaults also include ClientVersion (a string); a partial per-flag object replaces the default | — | `feature-flag.types.ts:124-127`; `main.bootstrap.ts:81` | — | FILES | partly |

## 12. Final audit additions (2026-11-28)

The final audit added 5.x conditions **W5-62 … W5-77** and 4.x conditions
**F4-64 … F4-85**, the missing rows **F4-07** and **F4-22** (= F4-70), and
corrected W5-01, W5-02, W5-16…18, W5-29, W5-40, W5-49, W5-57, G5-22,
F4-06, F4-21, F4-23, F4-26/27, F4-32, F4-37, P4-07, P4-16, D-09, D-28,
D-29 and D-34. The full rows, with citations and how each is decided, are
in `docs/tasks/se-flow/AUDIT-CORRECTIONS.md` §D, which is binding where it
differs from the rows above.
