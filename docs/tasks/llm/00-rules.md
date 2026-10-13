# LLM requests: rules

Source: the owner's master prompt "one safe, optimized path to the LLM
(masking, size and cost) for the Apty Agent", base `origin/main` at `c64838b`
(231 commits). Each work package is in its own file in this directory.
Re-read these files after a context compaction; never guess scope.

## How to work

1. One branch, `optimize/llm-requests`, from the latest `origin/main`. Never
   commit to `main`, never merge into `main`, never push any branch or tag,
   never force-push.
2. Read `CLAUDE.md` and `docs/STATUS.md` first. Keep `docs/STATUS.md` current.
   Verify with `tooling/scripts/verify-quiet.sh typecheck lint test audit build`.
   Never read minified bundles, `dist/assets`, source maps or lockfiles.
3. Measure first, then change. Every work package reports numbers from the
   request-anatomy harness (`npm run report:request-size`). Tokens are
   estimated as characters / 4.
4. Evidence over claims: a work package is done only with passing tests and
   pasted output. For every behavior change, run the new test against the old
   code first and show it fail. Mark unfinished work "partial". Never delete
   or weaken a failing test; never write assertion-free tests.
5. Unit tests for every behavior change. Anything crossing the Chrome
   boundary also gets a real-browser test in `tooling/e2e/*.e2e.test.mjs`
   using `tooling/e2e/harness.mjs` (`startMockModel`, `callToolThenReport`,
   `openSidePanel`, `chatAndWait`, `extensionPage`, `restartAgent`). Run with
   `npm run build && npm run test:e2e` (Chromium at `/opt/pw-browsers`,
   `--test-timeout=180000`).
6. The data can be healthcare data. Add no dependency, permission or network
   call. Never log keys, tokens, page content or URLs with query strings. Keep
   `externally_connectable: {"ids": []}`. Respect `npm run audit:architecture`:
   `agent-core` is provider- and Chrome-free and must not import
   `@apty/debug-contract`; implementations are injected from the extension.
7. Owner decisions not to revisit: "save" is not a risky click word; JSON
   exports get no header line; right-click stays gated; no
   `@vitest/coverage-v8` in `apps/mcp-bridge`; skills stay.
8. Do not claim real-provider savings, real prompt-cache hits or
   real-tenant masking results: none are run against a real provider or
   tenant. Do not change redaction semantics, the approval gate, deny lists
   or existing tool behavior beyond what a work package states.

## Checkpoints (end of Phase A, B and C)

- Full `verify-quiet.sh` and e2e suite, summaries pasted.
- `apty-agent-review-<phase>-<shortsha>.zip` from a clean build.
- A git bundle with `HEAD` and `refs/heads/optimize/llm-requests`, verified
  and test-applied in a scratch clone; `SHA256SUMS.txt`; a secret scan of
  the diff.
- `REVIEW.md`: per work package the change, commit hashes, measured
  before/after numbers, what is not done and why, "Observed, not changed",
  and a five-minute owner test script.
- Then stop. Proceed only after the owner's literal "approved"; start the
  next phase only after "continue" (rebase onto the new `origin/main`, no
  merge commits). After "approved", hand over apply commands for the owner
  to run; never push.

## Defaults to confirm in REVIEW.md (yes/no)

1. Strict withholds form values; Standard masks them; Off shows them.
2. `screenshotPolicy` defaults to "ask".
3. User messages get structural-secret masking in Strict and Standard, not Off.
4. Pruning keeps the last 4 full tool results; per-result cap 2,000 tokens.
5. Prompt caching is on by default, for Anthropic only.

## Verified at `c64838b` (re-checked against the code, not copied)

- `selectRelevantTools(userMessage)` (`browser-runtime/src/tools/tool-relevance.ts`)
  matches keyword groups on the current message only; casual or <=3-word
  messages get `[]`; unmatched get `tabs` + `page`.
- `AIPex.runExecution` (`agent-core/src/agent/aipex.ts`) clones the agent with
  the per-turn tools and runs `callModelInputFilter` before every model call:
  `shapeScreenshotItems(sanitizeReasoningItemsForModel(...))`. Retries:
  `LLM_CALL_MAX_ATTEMPTS = 3`; `DEFAULT_MAX_TURNS = 30`.
- `ConversationCompressor` is built only when `options.compression` is passed;
  nothing in `apps/browser-extension/src` passes it.
- No prompt caching: `services/ai-provider.ts` creates plain AI SDK providers.
- Redaction already has one entry point:
  `browser-runtime/src/runtime/redaction-mode.ts` (`getRedactionMode`,
  `currentRedactionMode`, `redactText`, Strict default, kept in sync via
  `chrome.storage.onChanged`). Reuse it; do not add a second mode reader.
- `collector.ts`'s `resolveElementValue` masks only `type=password`; other
  input, textarea, select and contenteditable values and all text nodes pass
  through. `take_snapshot` and `search_elements` (`tools/snapshot.ts`) apply
  no redaction or cap.
- `gateRiskyAction` (`tools/approval.ts`) is the approval gate to reuse.
