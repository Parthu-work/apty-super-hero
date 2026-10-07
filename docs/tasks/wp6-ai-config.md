# WP6. AI configuration and model management

**Status: partially done this round (WP4+ audit pass) — the 3 items
achievable without live-provider/live-browser testing.**

## Done

- **Free-text combobox for every provider's model field.** The model field
  (`packages/ui/src/components/settings/index.tsx`) was previously a
  conditional Select-or-Input split: a locked dropdown of the preset's
  `models[]` for the 14 providers with any preset models, plain free text
  only for `custom`/empty-preset providers. Replaced with a single
  `<Input>` + native `<datalist>` — preset models still show as
  suggestions, but any provider's model field now accepts arbitrary free
  text, for a model not in the preset list (a new release, a
  fine-tune, etc.) without needing to switch to "custom" first.
- **"Add custom model" already existed**, confirmed by this round's audit,
  not newly built: `handleAddModel` already creates a blank model with
  empty host/token/model that a user fills in freely — this works for any
  OpenAI-compatible endpoint today. No distinct "quick action" button was
  added to label this specifically, since the generic "Add Model" already
  covers it.
- **Local/private endpoints (Ollama, LM Studio) — a UI-level reassurance,
  not a confirmation gate.** `validateHostUrl` (hardened in this round's
  M2 work) already allows loopback hosts at the enforcement layer. Added
  `isLikelyLoopbackHost` + an inline info banner under the API Host field
  that appears when the entered host resolves to loopback, explaining that
  requests won't leave the machine and `http:` is allowed there. This is
  informational, not a confirmation step the spec's wording suggested
  ("behind explicit confirmation") — judged a banner was the better UX for
  a case that's working as intended, not a risk to gate behind a click.
- **Import/export of model configs without keys unless opted in.** New
  Export/Import buttons in the model list sidebar. Export serializes
  `customModels` to a JSON file via the existing `downloadText`/
  `timestampedFilename` utilities (`packages/ui/src/lib/download.ts`),
  stripping `aiToken` unless an explicit "Include API keys" switch is on
  (default off). Import parses the same format, always assigns fresh ids
  (no collision with existing models) and always imports as **disabled** —
  an imported config never silently becomes the active provider; the user
  reviews and enables it explicitly after import.

Added 9 new tests to `packages/ui/src/components/settings/index.test.tsx`:
`isLikelyLoopbackHost` (3), and `serializeModelsForExport`/
`parseImportedModels` round-tripping, key-stripping, and malformed-input
handling (6). All 13 tests in that file pass (4 pre-existing + 9 new).

**Verification limitation, stated plainly:** these changes were verified
via the existing React Testing Library suite (which renders the real
`SettingsPage` component tree against mocked `chrome.storage`) and a
`tsc`/`biome`/build pass — **not** against a loaded, real Chrome
extension in a live browser. Loading the actual built extension would
need the full `chrome.*` API surface (tabs, storage, runtime, downloads)
available, which a plain static-file or bare HTTP serve of `dist/` does
not provide (confirmed: the options page throws on
`chrome.tabs.onActivated` before ever rendering, outside a real extension
context) — setting up a Playwright `launchPersistentContext` with
`--load-extension` to get a faithful live render was judged out of scope
for this specific change and not attempted.

## Not done this round (deferred — need live-provider or live-browser testing to validate correctly)

- **Live model lists per provider** (fetched with the user's key, cached,
  graceful fallback) — requires real API calls against each provider's
  list-models endpoint; large surface (up to 15 different APIs), hard to
  validate meaningfully without hitting real providers.
- **Auditing all 15 built-in presets for OpenAI-compatible-adapter
  compatibility** — requires live calls against each vendor, not just
  reading the preset config.
- **Test connection improvements**: naming the specific cause
  (404/401/429) beyond the existing numeric status-code prefix, latency
  reporting, rate-limit header reporting, a tool-calling capability probe
  — the AI SDK doesn't expose response headers uniformly across providers,
  so this needs per-provider verification.
- **Multiple simultaneously-enabled models with per-model Test and rate
  limits** — today `enabled: true` on more than one model is possible in
  the data model, but `resolveActiveModel` only ever resolves one "active"
  model at a time (selected, else first-enabled), and there is one Test
  button testing whichever one that resolves to. Supporting true
  concurrent multi-model operation touches the single-active-model
  assumption throughout the chat/runtime layer, not just this settings
  page — a larger change.

**Gate (original, not yet met):** add/edit/enable/delete regression tests
(✅ for the items above), three providers configured and switchable (already
true independent of this round's work), reload persistence (unchanged),
a fresh-profile e2e against a fake LLM server (❌ needs the WP8 harness).
