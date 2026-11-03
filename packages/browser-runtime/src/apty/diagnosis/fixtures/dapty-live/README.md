# Ask Dapty live-tenant fixtures

Captures from a live tenant's Ask Dapty chat, redacted, each with the card
the SE observed. `dapty-live-fixtures.test.ts` runs the Ask Dapty check on
every case here and fails when it disagrees with the card. Until the first
evidence arrives this folder holds only this README, and the suite has no
cases.

## Layout

One folder per case, named for what it shows, in kebab-case and with no
tenant, customer or person in it (`aptyid-chat-panel`,
`cdn-stored-chat-retired-flow`, `injected-cors-rejected`):

```
dapty-live/
  <case>/
    capture.har.json   the redacted HAR the check runs on
    expected.json      what the card showed: verdict, rule ids, gates, suggestion rows
    evidence.json      the evidence bundle's build facts and summary, for reference
```

## Adding a case

1. The SE runs the case on the live tenant with Settings → Troubleshooting
   → Developer tools on, clicks **Export evidence** on the Ask Dapty card,
   and records a HAR of the page with the widget's chat open (Preserve log
   on), so it holds the chat call, the stored chat if any, and the content
   files.
2. Redact the HAR (checklist below).
3. Convert:

   ```bash
   node tooling/scripts/dapty-bundle-to-fixture.mjs apty-dapty-evidence-<timestamp>.json <case> --har <redacted.har>
   ```

   It writes the three files here, and refuses a HAR that still holds an
   email address, a cookie or an authorization header.
4. Run the suite:

   ```bash
   cd packages/browser-runtime && npx vitest run src/apty/diagnosis/dapty-live-fixtures.test.ts
   ```

   `expected.json` is what the SE saw on the live tenant, so it is not
   edited to make the test pass. If the check disagrees, it is wrong for the
   real shape: fix the check, with a regression test, in the same change.

## Redaction checklist

Before a HAR is committed:

- [ ] **Hosts**: replace the customer's application hosts with
      `*.example.test`, and Apty's tenant hosts with `client.apty.example`
      and `api.apty.example`, in every URL, the `Origin` and `Referer`
      headers and the page's own entry.
- [ ] **IDs**: replace the tenant, application, environment, user and chat
      ids in paths, query strings and bodies with synthetic ones, the same
      way everywhere (`0f000000-0000-7000-8000-000000000000` style, as in
      `content-5x`). Content item `sourceId`s may stay if they mean nothing
      outside the tenant; otherwise replace them consistently in the chat
      and the content files.
- [ ] **People**: no name, email, phone, employee number or user value in
      the chat text, the stored chat, `chat-list.json`, the content files or
      the page.
- [ ] **Credentials**: remove `Cookie`, `Set-Cookie` and `Authorization`
      headers, and any token in a query string or body.
- [ ] **Text**: keep the chat's questions and answers only as far as the
      case needs them; rewrite anything a customer would recognise.
- [ ] **Entries**: drop entries unrelated to Apty (analytics, the
      application's own API), keeping the page's document entry.
- [ ] **Check**: search the file for the customer's name, domain and any
      email (`@`) before committing.
