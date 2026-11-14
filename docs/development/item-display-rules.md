# When the 5.x player shows a tooltip, launcher or validation (KB-RAG K26 T0)

**Status: partial.** This is T0 of [FIXES-K26.md](../tasks/kb-rag/FIXES-K26.md):
one table per item kind, a row per condition the 5.x player checks before it
shows the item, each with the apty-dap file and line (commit `4c406d5`), the
content file and field it reads, and whether the Agent can see it.
`aptyInc/apty-dap` could not be attached to the session that implemented K26
(13 Nov 2026), so no row below has a fresh file-and-line citation. Under the
hard rule "never invent an Apty file shape", the check pack
`item-not-showing` (T3) was **not** written: each of its gates must come from
this file.

## What this repository already holds from 4c406d5

These are read today by `content-not-visible.ts` for every content kind,
including the three here (`KINDS` in `apty/diagnosis/types.ts`: `tooltip.json`,
`launcher.json`, `validation.json`, with segment fields `tooltipIds`,
`launcherIds`, `validationIds`). Their `Verified on` line is "5.x code,
commit 4c406d5, 2026-09-22; from code, not runtime-verified". They are the
conditions T3 can reuse once T0 confirms they also govern showing the item on
the page, not only listing it in the widget:

| Condition | Where this repository reads it | Agent can see it |
| --- | --- | --- |
| The item is in the kind's content file for this environment | `content-not-visible.ts` (`environmentGate`, `resolveItems`, rule CNV-02) | In a content file |
| The item's own settings that hide it | `content-not-visible.ts` (`flagCauses`, CNV-03) | In a content file |
| Segments that include the item, and their rules | `content-not-visible.ts` (`segmentGate`, `segment.json`, `rule.json`) | In a content file; membership only in the browser |
| The visibility rule (`visibilityRuleId`, `visibilityRuleAction`) | `content-not-visible.ts` (`visibilityGate`) | In a content file; its result only in the browser |
| The stored element and how the player resolves it | `element-not-found.ts` (rule ids SEL-*) | In a content file and the page |

## What T0 must still find, with file and line in apty-dap at 4c406d5

| Kind | Condition | Found |
| --- | --- | --- |
| All three | Whether the conditions above also decide showing on the page (not only listing in the widget) | Not yet |
| All three | Page or URL scope, and process or tag scope (`processIds`, `tagIds`) | Not yet |
| All three | Per-user state that hides an item after it was seen or dismissed, and where it is stored | Not yet |
| Tooltip | The trigger (hover, click, page load, focus) and any delay | Not yet |
| Launcher | Placement, and anything that hides the launcher icon | Not yet |
| Validation | The field rule, when it is evaluated (blur, submit), and what stops it (for example a disabled element) | Not yet |

Any condition the Agent cannot see becomes a line in the verdict's "not
checked here" list, never a guess.

## How to finish

```bash
git clone --no-checkout https://github.com/aptyInc/apty-dap ../apty-dap
```

```bash
git -C ../apty-dap checkout 4c406d5 -- player
```

Then fill the tables above with `file:line`, and run T1 to T5 of
FIXES-K26.md. The published cards T2 can cite, and the drafts still needed,
are in [`docs/kb-drafts/README.md`](../kb-drafts/README.md).
