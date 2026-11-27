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
| W5-02 | Injected mode only: the storage iframe loads within 15 s | page | `index-injected.tsx:51-54,88-96` | P | **new** |
| W5-01 | Top frame only; other frames run only the iframe script | page | `main-content-script/index.tsx:12-14` | P | info |

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
| G5-22 | The user file is parsed whole; any schema failure means empty preferences (completions forgotten) | schema | `user-preference.service.ts:62-75` | U | **new** |

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
| F4-06 | `attachedRule.visibilityResult` must be Show or unset (fail-open) | `rules.json` | `rule-engine.helpers.ts:388-411` | R until O-3 | listed |
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
| O-4 | Running a tenant's custom scripts (`customScript` rules, 4.x `segment-js.js`, element custom scripts) to decide a rule | Off by default. If allowed: in a sandboxed interpreter in the Agent's own isolated world, with a timeout, and never with network access |
| O-5 | Asking the SE for an Apty ID kept in Client storage | Ask once, only when a user-dependent row needs it, with one copy-paste step |
| O-6 | Fix WNV-07 now (5.x widget display per environment) | Yes: first item of the build plan, since it is wrong today |
