# Request anatomy

What one request to the model is made of, what keeps each part small, and
how its size is measured and gated. Sizes are estimated tokens: characters
/ 4, with an image counted at 1,600.

## Parts

| Part | What decides it | Code |
|---|---|---|
| System prompt | A byte-stable core on every call, plus each section of guidance only when the call offers one of its tools | `SYSTEM_PROMPT_CORE`, `composeSystemPrompt` in `packages/ui/src/components/chatbot/constants.ts` |
| Tool schemas | The tool groups the message selects, plus those of the chat's last 3 tool-using turns, in registry order | `createStickyToolSelector` in `packages/browser-runtime/src/tools/tool-relevance.ts` |
| History | The session's earlier turns; a summary in their place when **Summarize earlier turns** is on | `ConversationManager`, `ConversationCompressor` in `packages/agent-core/src/conversation/` |
| Tool results | Each cut to 2,000 tokens; results older than the newest 4 become stubs | `createRequestBudgetFilter` in `packages/browser-runtime/src/runtime/request-budget.ts` |
| Request budget | When set in Settings: older results, messages and turns give way until the request fits, or it stops before it is sent | `createContextBudgetFilter` in `packages/browser-runtime/src/runtime/context-budget.ts` |

On Anthropic, the system prompt (which covers the tools before it) and the
newest message are cache breakpoints (`ai-provider.ts`). The fixed tool
order and the byte-stable core keep the start of each request the same.

## Measuring

```bash
npm run report:request-size
```

It runs `apps/browser-extension/src/hooks/request-anatomy.scenarios.test.ts`,
which builds named requests with the extension's own selection, prompt and
filters, and prints each part, raw and as sent, under request budgets, and
for a chat after a summary. `--json` prints the numbers.

## The gate

`tooling/e2e/request-budgets.json` holds each named request's size as built
plus 10% headroom. The scenarios test fails when one grows past its budget,
or when a scenario has none. When a change makes a request larger on
purpose, raise its budget in the same commit and say why; regenerate the
numbers with the report above.
