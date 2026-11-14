# Organization policy

Apty IT controls where Apty knowledge-base (KB) text may go, and which AI
destinations the Agent may use, with a policy for this extension in
Chrome's managed storage (KB-RAG K22,
[D-SEC1 to D-SEC7](../tasks/kb-rag/decisions.md#d-sec1-kb-text-never-reaches-a-model-by-default)).
The extension reads it with `chrome.storage.managed`; its schema is
[`apps/browser-extension/managed-schema.json`](../../apps/browser-extension/managed-schema.json),
named by the manifest's `storage.managed_schema`. The user cannot change a
value the policy sets.

## What happens without a policy

The extension works as before, with two differences that need no policy:

- KB card text stays in the side panel. The model gets the ids of the cards
  the user saw, never their text, unless every loaded pack is a demo pack
  (its Confluence site ends in `.invalid`).
- While an Apty KB pack (not a demo pack) is loaded, redaction is never
  weaker than Standard.

## Keys

Every key is optional. A policy with an unknown key, a wrong type or a value
out of range is **invalid**: the extension then makes no AI request at all,
withholds KB text, keeps the MCP bridge off, uses Strict redaction, and
Preflight names the reason (fail closed).

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `kbToModel` | `"off"` or `"approved"` | `"off"` | `"approved"`: KB card text may go to a destination the allow-lists permit. Otherwise it is withheld, and `search_kb` is not offered. |
| `kbToMcp` | boolean | `false` | Whether a KB result reaches a local MCP client with its card text. Otherwise it arrives as "KB result withheld by policy. Cards: <ids>." |
| `allowedProviders` | string array | any | Provider keys the user may use: `openai`, `anthropic`, `google`, `azure`, `openrouter`, `requesty`, `deepseek`, `groq`, `together`, `mistral`, `cohere`, `perplexity`, `fireworks`, `replicate`, `custom`. |
| `allowedOrigins` | string array | any | Base URL origins, compared exactly on scheme, host and port: `https://` only, or `http://` for a loopback host (`localhost`, `127.x.x.x`, `[::1]`) for a local model. No path. |
| `allowedModels` | string array | any | Model ids the user may use; also what Fetch models lists. |
| `preset` | object: `aiProvider`, `aiHost`, `aiModel`, `aiToken`, `aiWorkspaceId` (strings) | none | Written into the user's settings and locked: Options shows them read-only with "Set by your organization". |
| `redactionFloor` | `"strict"` or `"standard"` | none | The weakest redaction mode the user may choose. |
| `allowCustomModels` | boolean | `false` when any allow-list is set, else `true` | Whether the user may add their own models in Options. |
| `allowMcpBridge` | boolean | `true` | `false`: the extension opens no connection to the MCP bridge, and Options shows it locked off. |
| `auditRetentionDays` | integer, 1 to 365 | `30` | How long the record of KB text sent to AI is kept. Under any policy the user cannot clear it. |
| `trustedPackKeys` | array of `{ keyId, spki, name }` | none | KB pack signing keys trusted besides the built-in ones (KB-RAG K23, D-SEC9). `keyId`: 16 hex characters; `spki`: the public key's SPKI DER in base64, as `pnpm kb:keygen` prints them. An entry whose `keyId` does not match its `spki` trusts nothing. |
| `revokedPackKeyIds` | string array | none | Key ids never trusted, built-in ones included. A loaded pack signed by one stops being used at the next question. |
| `allowUnsignedPacks` | boolean | `false` | Use unsigned packs (built before K23, or with `--unsigned`), for a transition only. |
| `caseRetentionDays` | integer, 1 to 365 | `90` | How long a case record (KB-RAG K25, D-CASE1) is kept on the device after its last update. |
| `maxPackAgeDays` | integer, 1 to 365 | none | No pack is used more than this many days after it was built, whatever its own `expiresAt` (D-SEC11). |
| `kbPackSources` | object: `"4.x"`, `"5.x"`, `"common"` to a URL | none | KB-RAG K26 (D-DEL1). Where the extension fetches each version's pack, with the user's own session (`credentials: "include"`, D-DEL2). `https://` only, no user info, no fragment, at most 2,048 characters; any other key or scheme makes the policy invalid. Absent: manual import only. See [KB_PACK_DELIVERY.md](../release/KB_PACK_DELIVERY.md). |
| `kbPackCheckHours` | integer, 1 to 168 | `6` | How often the extension checks each source (D-DEL7), besides browser start and **Check now**. |
| `domConfigRetentionDays` | integer, 1 to 365 | `30` | KB-RAG K26 (D-DOM1). How long a held DOM Config capture is kept on the device after it was last saved; Discard capture deletes it sooner. |
| `allowManualPackImport` | boolean | `false` | Whether the user may import a pack by hand for a version `kbPackSources` names (D-DEL5). Versions with no source are always importable. |

A request outside the allow-lists is not sent: not a chat, a custom model,
the summary model, the connection test or Fetch models. The chat says which
values are allowed.

**Warning:** a key set in `preset.aiToken` is visible to the user in
chrome://policy. Prefer an organization gateway that authenticates the user
without a long-lived shared key (D-SEC7), set as an OpenAI-compatible origin
with `allowedOrigins` and `preset.aiHost`.

## Recommended policy

A starting point for Apty IT; put your own Azure OpenAI resource (or
gateway) in `allowedOrigins`:

```json
{
  "kbToModel": "approved",
  "kbToMcp": false,
  "allowedProviders": ["azure"],
  "allowedOrigins": ["https://<apty-tenant>.openai.azure.com"],
  "redactionFloor": "strict",
  "allowCustomModels": false,
  "allowMcpBridge": false,
  "auditRetentionDays": 30,
  "trustedPackKeys": [
    { "keyId": "<16 hex>", "spki": "<base64>", "name": "Apty KB owner" }
  ],
  "maxPackAgeDays": 90
}
```

Under an invalid policy the extension trusts only the demo key (and only for
`.invalid` sites), allows no unsigned pack, and so uses no KB pack but demo
packs.

## Deploying it

The policy is for the extension's ID. The Agent's ID is fixed by the
manifest's `key`: `bpiondflhhdplemamgggcdajclmoeple` (check it in
chrome://extensions). The paths below follow Chrome's and Edge's
documentation for extension ("3rd party") policy.

### Windows

Registry, per machine (`HKEY_LOCAL_MACHINE`) or per user
(`HKEY_CURRENT_USER`):

- Chrome: `Software\Policies\Google\Chrome\3rdparty\extensions\<extension-id>\policy`
- Edge: `Software\Policies\Microsoft\Edge\3rdparty\extensions\<extension-id>\policy`

A string or a whole number is a value of that type under `policy`
(`REG_SZ` for `kbToModel`, `REG_DWORD` for `auditRetentionDays` and for a
boolean, 0 or 1). A list is a subkey with values named `1`, `2`, …; an
object such as `preset` is a subkey with one value per field. Group Policy
can deploy the same keys.

### macOS

A configuration profile (for example through your MDM) with a payload for
the domain `com.google.Chrome.extensions.<extension-id>` (Edge:
`com.microsoft.Edge.extensions.<extension-id>`), holding the keys above as
plist values (`<string>`, `<integer>`, `<true/>`, `<array>`, `<dict>`).

### Linux

A JSON file in Chrome's managed policy directory, for example
`/etc/opt/chrome/policies/managed/apty-agent.json` (Chromium:
`/etc/chromium/policies/managed/`):

```json
{
  "3rdparty": {
    "extensions": {
      "<extension-id>": {
        "kbToModel": "off",
        "redactionFloor": "strict",
        "allowedProviders": ["openai"],
        "allowedOrigins": ["https://api.openai.com"]
      }
    }
  }
}
```

## Checking it

1. Open chrome://policy and click **Reload policies**. The extension's
   policy is listed under its name, with no errors.
2. Options → Connection → **Preflight**:
   - **Organization policy**: none, active, or invalid with the reason;
   - **AI destination**: the provider, origin and model in use, and whether
     the policy allows them;
   - **KB text to AI**: withheld, allowed to a named destination, demo
     packs only, or no pack loaded.
3. Options → AI provider shows what the policy presets as read-only, and
   Data handling shows the redaction modes below the floor disabled, and
   **KB text sent to AI** with the count, Export (JSON) and Clear (disabled
   under a policy).

Within one browser profile, a user who can edit the machine's policy files
or remove the extension is outside what an extension can enforce; deploy the
extension itself by policy too if that matters.

## For developers

Playwright cannot set managed storage, so the E2E tests use a build made
with `VITE_APTY_E2E_POLICY_SEAM=1` (`tooling/e2e/policy-build.mjs`), which
reads the policy from a `chrome.storage.local` key the test writes. A
production build drops that code, and `npm run build` fails if `dist/`
holds it (`tooling/scripts/check-dist-policy.mjs`).

In this repository's CI container, a policy file in
`/etc/chromium/policies/managed/` is read by the bundled Chromium (its other
policies show in chrome://policy), but it does not deliver a 3rd party
policy to an extension loaded with `--load-extension`, so the manual check
above is still to be done on a machine with a real Chrome deployment.
