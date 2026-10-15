# Apty Agent privacy statement

Apty Agent is a Chrome extension for debugging web applications and Apty's
own products. It has no Apty server behind it: everything it does runs in
your browser, and the only data that leaves the device goes to services you
configure yourself.

## What leaves your browser

| Destination | What is sent | When |
|---|---|---|
| The AI provider you configure (your own API key) | Your messages, and the results of the tools the agent runs: page text and structure, console output, network request details, screenshots you ask the agent to look at, DOM Health findings | Only while you chat. Nothing is sent before you configure a provider. |
| The Apty Client extension you connect | Requests for its own service-worker logs, status and observed resources | Only when the agent investigates the Client. |
| A local MCP daemon you connect (`localhost` only) | Tool results for the MCP client you run, such as Claude Code | Only while you keep the bridge connected. |
| Websites a skill script requests | Whatever the script sends, without your cookies | Only with skill execution turned on, and only after you allow that script to run. |
| A diagnostic HTTP endpoint built into your build (`VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT`) | Requests for service-worker diagnostics | Only if your build sets it; empty by default. |

There is no analytics, telemetry, crash reporting or advertising. Apty does
not receive your conversations, keys or page data.

Files you export yourself (a conversation, a response body, a route probe
report, a DOM Health validation bundle) are saved or copied only when you
click; nothing is uploaded. The validation bundle holds hostnames, URL
templates without queries, counts, hashes and settings, never page text,
input values, titles or record numbers, and you review it before saving.

## What your AI provider keeps

What a provider does with a request after it arrives is set by that
provider's own terms, not by this extension. Read the policy for the
provider you configure before you use it on pages that hold health or other
regulated data:

| Provider | What this extension asks for | Provider's data policy |
|---|---|---|
| OpenAI | Every request is sent with `store: false`, so the Responses API is asked not to keep it as a stored response | [API data usage](https://platform.openai.com/docs/guides/your-data) |
| Anthropic | Nothing beyond the request | [Privacy center](https://privacy.anthropic.com/), [commercial terms](https://www.anthropic.com/legal/commercial-terms) |
| Google (Gemini API) | Nothing beyond the request | [Gemini API terms](https://ai.google.dev/gemini-api/terms) |
| Azure OpenAI | Nothing beyond the request | [Data, privacy and security](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy) |
| OpenRouter | Nothing beyond the request | [Privacy policy](https://openrouter.ai/privacy) |
| Requesty | Nothing beyond the request | [Privacy policy](https://www.requesty.ai/privacy) |
| DeepSeek | Nothing beyond the request | [Privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html) |
| Groq | Nothing beyond the request | [Privacy policy](https://groq.com/privacy-policy/) |
| Together AI | Nothing beyond the request | [Privacy policy](https://www.together.ai/privacy) |
| Mistral | Nothing beyond the request | [Terms](https://mistral.ai/terms) |
| Cohere | Nothing beyond the request | [Privacy policy](https://cohere.com/privacy) |
| Perplexity | Nothing beyond the request | [Privacy policy](https://www.perplexity.ai/hub/legal/privacy-policy) |
| Fireworks | Nothing beyond the request | [Privacy policy](https://fireworks.ai/privacy-policy) |
| Replicate | Nothing beyond the request | [Privacy policy](https://replicate.com/privacy) |
| Custom (any OpenAI-compatible host) | Nothing beyond the request | The policy of whoever runs that host |

## What the AI provider never sees in the clear

Before any diagnostic data reaches the model, the agent redacts what looks
sensitive: `Authorization`, cookie and API-key headers, tokens, passwords,
email addresses and similar values in console output, request details and
JSON bodies. Redaction is pattern-based, so it can miss secrets in an
unusual shape; avoid investigating pages that hold data you must not share
with your AI provider.

**Settings → General → Data handling → Redaction** chooses how much is
masked; every tool result, log line and body goes through the same setting:

| Mode | Masks | Values typed into form fields |
|---|---|---|
| Strict (default) | Secrets, personal data (names, usernames, emails, patient fields) and page context (titles, paths) | Not sent at all |
| Standard | Secrets and personal data; keeps page titles and paths | Replaced with `[masked]` (a filled field can be told from an empty one) |
| Off (development only) | Only secrets recognised by their shape: tokens, API keys, JWTs, bearer credentials, emails | Sent as the page has them |

"Form fields" means inputs, text areas, selects (the chosen option) and
editable regions, read through `search_elements` or `get_editor_value`; the
URL of the page in `get_page_metadata` loses its query string in Strict and
keeps only the parameter names in Standard. Page text and labels are sent as
the page shows them, so a patient name printed as plain text on a page is
**not** hidden by these modes. Checkbox and radio states are also sent.
Anything you type in the chat has tokens, keys, JWTs and emails masked in
Strict and Standard.

**Settings → General → Data handling → Screenshots** decides whether a
screenshot of the page may be sent to your AI provider: **Ask each time**
(the default; you can allow one site for 15 minutes), **Always allow**, or
**Never**. A screenshot is pixels, so redaction cannot mask it. Screenshots
kept on your device, such as one copied to the clipboard, are not affected.
Requests from an MCP client follow the same setting.

Off asks for confirmation and shows "Redaction is OFF" in the side panel for
as long as it is on. Preview shows a built-in sample with fake data before
and after each mode. Copied and downloaded messages start with a line naming
the mode; a downloaded JSON body carries it in its file name.

Response bodies of page network requests are **not** captured unless you
turn on **Settings → General → Data handling → Capture response bodies**.
Hosts or URL fragments you add to the deny-list there are never read, both
in page capture and when you ask for a resource the Apty Client loaded
("get segments.json"): for a listed URL the agent reports the request's
metadata and that the body was withheld, and never asks the Client for the
body. The list is empty by default; add user-preference and identity
endpoints (for example `/users/`, `/api/me`, `/userinfo`) if those bodies
must not reach your AI provider.

## What is stored on your device

| Data | Where | How long |
|---|---|---|
| Settings and API keys | `chrome.storage.local`, readable only by the extension's own pages | Until you remove them or the extension |
| Conversations | The extension's IndexedDB | Deleted after 7 days without use; at most 5 are kept |
| Screenshots | The extension's IndexedDB | Deleted after 7 days without use; at most 50 are kept |
| Evidence and investigations from the current session | `chrome.storage.session` | Cleared when the browser closes |
| Remembered approvals ("Allow on this site for 15 min") | `chrome.storage.local` | 15 minutes, or until revoked |

**Settings → General → Stored conversations and screenshots → Delete stored
data now** removes conversations and screenshots at once. Web pages and
other extensions can't read any of this: storage is locked to the
extension's own pages and service worker.

## Actions on your behalf

The agent asks before it runs JavaScript in a page, fills fields, types,
uploads or downloads files, or runs a skill script. You approve each action
in the side panel, or allow one tool on one site for 15 minutes. If the tab
moves to another site while the prompt is open, the action is not run. The
AI model can't approve its own actions.

## Permissions

Why the extension needs each Chrome permission is listed in
[`docs/security/PERMISSIONS.md`](docs/security/PERMISSIONS.md). Bookmarks,
history and extension management are optional and are requested only when
you turn them on.

## Contact

Report privacy or security concerns as described in
[`SECURITY.md`](SECURITY.md).
