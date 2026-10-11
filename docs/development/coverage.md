# Coverage gate

`npm run test:coverage` runs Vitest with V8 coverage in every package and in
`apps/mcp-bridge`; CI runs it on every push. Each package measures all of
its `src/**/*.{ts,tsx}` except tests and type declarations.

## The rule: thresholds only go up

Each package's thresholds were set one point below the value measured when
the gate was widened (C5), and raised after C3, C1 and C2 added tests. They are a ratchet, not a target:

- Never lower a threshold. If a change drops coverage below it, add tests.
- When coverage rises, raise the threshold to one point below the new value
  in the same change.
- Never exclude a source file to pass the gate.

| Package | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `packages/agent-core` | 75 | 69 | 82 | 77 |
| `packages/dom-snapshot` | 89 | 81 | 96 | 91 |
| `packages/ui` | 43 | 34 | 42 | 44 |
| `packages/browser-runtime` | 48 | 44 | 52 | 48 |
| `packages/apty-debug-contract` | 83 | 77 | 92 | 86 |
| `apps/browser-extension` | 42 | 43 | 40 | 42 |
| `apps/mcp-bridge` | 20 | 17 | 23 | 20 |

## Stricter gates

Two groups of files keep the stricter gates they had before, measured over
the group:

- `packages/browser-runtime`: `tools/approval.ts`,
  `runtime/trusted-sender.ts`, `apty/external-messaging.ts`,
  `apty/network-capture-session.ts`, `apty/session-snapshot.ts`,
  `tools/network-capture.ts` (88 / 78 / 85 / 90).
- `packages/apty-debug-contract`: `redact.ts`, `json-redact.ts`,
  `contract.ts` (88 / 82 / 93 / 92).

## Running one package

```bash
cd packages/ui && npx vitest run --coverage
```

`apps/mcp-bridge` is not a workspace member. It has no coverage provider of
its own and uses the root `@vitest/coverage-v8` (4.1.0) with its own Vitest
(4.1.x), which prints a "mixed versions" warning; see `REVIEW.md`.
