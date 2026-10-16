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
| A local MCP daemon you connect (`localhost` only) | Tool results for the MCP client you run, such as Claude Code, filtered exactly like the results sent to the AI provider (see below) | Only while you keep the bridge connected. |
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

## What is masked before it leaves your browser

Every tool result goes through the same filter before it reaches the AI
provider or an MCP client. Its strength is set in **Settings → General →
Data handling → Redaction**:

| | Strict (default) | Standard | Off (development only) |
|---|---|---|---|
| Secrets recognised by their shape (tokens, API keys, JWTs, bearer credentials, emails) | Masked | Masked | Masked |
| `Authorization`, cookie and API-key headers; values of keys such as `password`, `token`, `secret` in JSON | Masked | Masked | Not masked |
| Values of JSON keys naming a person or record (`username`, `email`, `firstName`, `lastName`, `fullName`, `displayName`, `phone`, `address`, `dob`, `ssn`, `mrn`, any key starting with `patient`; `userId` is replaced by a stable pseudonym). A bare `name` key is not masked. | Masked | Masked | Not masked |
| Values of JSON keys holding page context (`page_title`, `page_path`, `page_search`, `referrer`) | Masked | Not masked | Not masked |
| Any web URL in a tool result | Query string and fragment removed; in the path, record numbers (5+ digits), GUIDs, long hex ids and email addresses become `:id` / `:email` | Each query value replaced with `[masked]`; the path is kept | Sent as is |
| A tab or page as the tab and page tools describe it | Tab id and origin only: no title, no path | Title and URL with masked query values | Sent as is |
| Values typed or chosen in form fields | Not sent | Replaced with `[masked]` | Sent as is |

What no mode hides:

- **Page text is sent as the page shows it in every mode.** A patient's
  name, record number, date of birth or diagnosis written as text on the
  page, or in a link label, reaches the AI provider when a tool reads the
  page. Redaction masks values by the key they sit under or by their
  shape, never by meaning, so it cannot recognise these in prose.
- In Strict, a path keeps its words and short numbers
  (`/patients/:id/chart`, `/orders/42`); a short record number of four
  digits or fewer, or a name written into a path, is sent. Standard keeps
  the whole path.
- Checkbox and radio states are sent in every mode.
- Page titles are sent in Standard and Off.

"Form fields" means inputs, text areas, selects (the chosen option) and
editable regions, read through `search_elements` or `get_editor_value`.
Page and tab contexts you attach to a message get the same URL and title
rules as the tab tools. Anything you type in the chat has tokens, keys,
JWTs and emails masked in Strict and Standard, and is otherwise sent as you
typed it.

Redaction is pattern-based, so it can miss a secret in an unusual shape.
Avoid investigating pages that hold data you must not share with your AI
provider.

MCP clients receive tool results after the same filter, in the same mode.
They do not receive your chat messages.

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
| The agent's history of each conversation (including raw tool results, before masking) | The extension's IndexedDB | Deleted with its conversation: by age, by the 5-conversation limit, when you delete the conversation from history, or by "New chat" |
| Screenshots | The extension's IndexedDB | Deleted after 7 days without use; at most 50 are kept |
| Evidence and investigations from the current session | `chrome.storage.session` | Cleared when the browser closes |
| Remembered approvals ("Allow on this site for 15 min") | `chrome.storage.local` | 15 minutes, or until revoked |

**Settings → General → Stored conversations and screenshots → Delete stored
data now** removes conversations, the agent's history and screenshots at
once. Web pages and
other extensions can't read any of this: storage is locked to the
extension's own pages and service worker.

## Actions on your behalf

The agent asks before it runs JavaScript in a page, fills fields (the
prompt lists each field and its value), types or presses keys, makes a
risky click or drag, opens or switches to a tab on another site, closes a
tab it did not open, uploads or downloads files, runs a skill script (the
prompt shows its first lines and arguments), or runs a DOM Health audit
that clicks through the application. You approve each action in the side
panel. For most of them you can instead allow that kind of action on one
site for 15 minutes; typing, key presses, clicks and drags are separate
kinds, so allowing one never allows another. Running JavaScript, closing a
tab and a clicking DOM Health audit always ask. If the tab moves to another
site while the prompt is open, the action is not run. The AI model can't
approve its own actions.

Skill scripts can't create or change files in a skill's `scripts/` folder,
so the agent can't write a script and then ask to run it: scripts come only
from skill packages you import. A file a skill script downloads always
opens the save dialog.

## Permissions

Why the extension needs each Chrome permission is listed in
[`docs/security/PERMISSIONS.md`](docs/security/PERMISSIONS.md). Bookmarks,
history and extension management are optional and are requested only when
you turn them on.

## Contact

Report privacy or security concerns as described in
[`SECURITY.md`](SECURITY.md).
