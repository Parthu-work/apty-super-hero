# Task specs

Owner prompts saved verbatim so a session can re-read its scope. A spec stays
here while a document or code comment refers to it, or while it describes
work [`docs/STATUS.md`](../STATUS.md) lists as open; the rest are in
[`docs/archive/tasks/`](../archive/tasks/) under the same names.

- `llm/`, `prod/`: open in STATUS.md (LLM Phases B and C; R6 and R9), and linked from STATUS.md and `REVIEW.md`.
- `widget-network.md`: the Widget network calls item is open in STATUS.md.
- `kb-rag/`: KB retrieval is open in STATUS.md; `decisions.md` holds the owner decisions D-KB1 to D-KB9, which `DECISIONS.md` links to; `FIXES.md` is the K10–K20 prompt.
- `se-flow/IMPLEMENTATION-PROMPT.md`: the master prompt for the SE debugging flow (replay, both versions, live checklist, Ask Dapty, Ask AI anyway), from `docs/development/se-flow-architecture.md` and `se-flow-coverage.md`.
- `se-flow/PHASE-1-WORKFLOWS.md`: Phase 1 of the master prompt — workflows only, for 4.x and 5.x, with all shared foundations. Later phases: element content (tooltips, launchers, validations), engagement content (announcements, checklists, knowledge content, onboarding), widget and the rest, then hardening.
- `se-flow/AUDIT-CORRECTIONS.md`: the final audit (binding): design changes, prerequisites, resolved contradictions, new and corrected conditions, new owner decisions.
- `00-context.md`: `widget-network.md` takes its rules from it.
- `master/`: `DECISIONS.md` points to it for the hardening decisions.
- `wp1-apty-integration.md`: named by `00-context.md` and `STATUS_HISTORY.md`.
- `wp2-producer-handoff.md`: named by `master/B1.md`.
- `wp4-security.md`, `wp5-chat-resilience.md`, `wp6-ai-config.md`: named by `STATUS_HISTORY.md` (wp5, wp6 also by `docs/archive/DECISIONS.md`).
