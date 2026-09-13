# Changelog

Meaningful changes to this repo, newest first. Not every commit is listed
individually where several form one logical change — see `git log` for the
full commit-level history.

## Unreleased (this session)

**Added**
- Evidence model and four Apty diagnostic provider interfaces
  (`packages/browser-runtime/src/apty/`): `AptyWidgetDiagnosticsProvider`,
  `AptyClientDiagnosticsProvider`, `AptyStudioDiagnosticsProvider`,
  `AptyServiceWorkerDiagnosticsProvider`, each with a `NotConfigured*`
  fallback — no fabricated Apty data.
- Sensitive-data redaction utility (`apty/redact.ts`, unit-tested) — strips
  `Authorization`/`Cookie`/`X-Api-Key` headers and inline
  `token=`/`password=`/`Bearer ...` patterns before data reaches the model.
- Two DevTools/CDP tools (`packages/browser-runtime/src/tools/devtools.ts`):
  `get_network_diagnostics` (correlated request/response/failure data) and
  `get_runtime_diagnostics` (browser-level log entries and uncaught
  exceptions) — both reuse the existing `debuggerManager`/`CdpCommander`.
- Three new Apty tools (`tools/apty.ts`): `get_apty_widget_diagnostics`,
  `get_apty_client_diagnostics`, `get_apty_studio_diagnostics`,
  `get_apty_service_worker_diagnostics` (4, plus the pre-existing
  `get_apty_page_logs`, renamed from `get_apty_debug_logs`).
- `packages/browser-ext/.env.example` with Apty integration config
  placeholders (Studio/Widget/Client/Service-Worker extension IDs,
  service-worker diagnostic endpoint) — wired through `background.ts` →
  `chrome.storage.local` → `apty/config.ts`.
- `PROJECT_PROGRESS.md`, `ARCHITECTURE.md`, `DECISIONS.md` (new),
  `SECURITY_AUDIT.md` and this `CHANGELOG.md` rewritten/updated to reflect
  actual implemented state.

**Changed**
- System prompt (`packages/aipex-react/src/components/chatbot/constants.ts`)
  rewritten from a generic "AIPex browser assistant" persona (tab/bookmark/
  history/shopping-style examples) to the Apty Live Browser Debugging Agent
  persona: the debugging loop, evidence-first CONFIRMED/LIKELY/POSSIBLE/
  UNKNOWN diagnosis format, explicit tool-boundary honesty, and an explicit
  prompt-injection defense instruction. Also fixed a latent type bug (was
  `string[]` assigned to a `string`-typed field; now a real joined string).
- Agent name: `"AIPex Browser Assistant"` → `"Apty Live Browser Debugging
  Agent"` (`browser-agent-config.ts`).
- `get_apty_debug_logs` renamed to `get_apty_page_logs`; now redacts log
  entries before returning them (previously did not).
- `mcp-bridge/src/tool-schemas.ts` updated to match the renamed/new tools.

**Tests**: 640 passing across all 5 packages (was 623; +7 for `redact.ts`,
+10 net from the tool-count increase not requiring new tests of their own
since they're thin Chrome-API wrappers — see `PROJECT_PROGRESS.md`'s "Not
Implemented" test section for why).

## Prior session

**Removed** (AIPex product features with no Apty relevance):
- Proxy/login auth mode routing through `claudechrome.com`
- Conversation sharing, user-manual replay-from-website, recording/
  screenshot upload to AIPex's backend, version checking against AIPex's
  release feed
- Voice input (ElevenLabs STT + VAD) and its `three.js` particle
  visualization — shrank the sidepanel bundle 724KB → 190KB
- AIPex's marketing/community UI (Discord/Twitter/WeChat links, buy-token
  prompts), non-English READMEs, AIPex's own release automation
  (`bump`/`release` GitHub workflows)

**Changed**:
- Rebranded manifest name/description, page titles, chat header default
  title, README as "Apty Agent"
- `externally_connectable` locked from `{"matches":
  ["http://localhost:*/*"]}` to `{"ids": []}` — see `SECURITY_AUDIT.md`
  finding #1

**Added**:
- `packages/browser-ext/src/apty-console-bridge.ts` — MAIN-world content
  script buffering console output/errors since page load
- Initial `get_apty_debug_logs` and `get_apty_widget_snapshot` tools (the
  latter later replaced by `get_apty_widget_diagnostics`, see Unreleased above)

## Initial import

- Cloned from [AIPexStudio/AIPex](https://github.com/AIPexStudio/AIPex)
  (MIT licensed) as the starting point.
