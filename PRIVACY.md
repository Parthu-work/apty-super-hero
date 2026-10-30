# Apty Agent privacy statement

Apty Agent is a Chrome extension for debugging web applications and Apty's
own products. It has no Apty server behind it: everything it does runs in
your browser, and the only data that leaves the device goes to services you
configure yourself.

## What leaves your browser

| Destination | What is sent | When |
|---|---|---|
| The AI provider you configure (your own API key) | Your messages, and the results of the tools the agent runs: page text and structure, console output, network request details, screenshots you ask the agent to look at, DOM Health findings. A check answered without the model (such as "my workflow is not visible") sends nothing itself; its result goes with your next message, masked like a tool result. With **Summarize earlier turns** on (Settings → AI → Request size; off by default), one more request asks the model to summarize a long chat's earlier messages, masked the same way | Only while you chat. Nothing is sent before you configure a provider; checks that need no model run without one. |
| The Apty Client extension you connect | Requests for its own service-worker logs, status and observed resources | Only when the agent investigates the Client. |
| A local MCP daemon you connect (`localhost` only) | Tool results for the MCP client you run, such as Claude Code, filtered exactly like the results sent to the AI provider (see below) | Only while you keep the bridge connected. |
| A diagnostic HTTP endpoint built into your build (`VITE_APTY_SERVICE_WORKER_DIAGNOSTIC_ENDPOINT`) | Requests for service-worker diagnostics | Only if your build sets it; empty by default. |

There is no analytics, telemetry, crash reporting or advertising. Apty does
not receive your conversations, keys or page data.

Files you export yourself (a conversation, a response body, a route probe
report, a DOM Health validation bundle, a DOM Config report or raw profile)
are saved or copied only when you click; nothing is uploaded. The validation bundle holds hostnames, URL
templates without queries, counts, hashes and settings, never page text,
input values, titles or record numbers, and you review it before saving.
"Ask about this result" on the DOM health page puts the same bundle in a new
chat as a chip you can remove; it goes to your AI provider only when you
press Send.

A HAR file you pick on **Check a HAR file** is read in the side panel only:
it is never stored or sent. "Ask about this result" there puts the check's
result, not the file or its name, in a new chat as a chip, sent only when
you press Send.

## What your AI provider keeps

What a provider does with a request after it arrives is set by that
provider's own terms, not by this extension. Read the policy for the
provider you configure before you use it on pages that hold health or other
regulated data:

| Provider | What this extension asks for | Provider's data policy |
|---|---|---|
| OpenAI | Every request is sent with `store: false`, so the Responses API is asked not to keep it as a stored response | [API data usage](https://platform.openai.com/docs/guides/your-data) |
| Anthropic | Requests are marked for prompt caching: Anthropic keeps the start of a request (the system prompt, the tools offered and the conversation so far, as masked) for about 5 minutes, so the next request can reuse it | [Privacy center](https://privacy.anthropic.com/), [commercial terms](https://www.anthropic.com/legal/commercial-terms) |
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
| In any text a tool result holds (a log line, a response body, a header written as text): a credential header line, and a value written after a credential word (`password=…`, `csrf_token: …`, `"authToken":"…"`); both lists below | Masked | Masked | Masked |
| Values of the tool result's own JSON keys named for a credential (`password`, `token`, `secret`, `cookie`, …; the exact names are below) | Masked | Masked | Not masked, unless the value is masked by one of the two rows above. A header name used as a JSON key (`{"Proxy-Authorization":"…"}`, `{"X-Api-Key":"…"}`) is not masked; the same header written as a text line is |
| Values of JSON keys naming a person or record (`username`, `email`, `firstName`, `lastName`, `fullName`, `displayName`, `phone`, `address`, `dob`, `ssn`, `mrn`, any key starting with `patient`; `userId` is replaced by a stable pseudonym). A bare `name` key is not masked. | Masked | Masked | Not masked |
| A medical record number written after `MRN` or `medical record number` in any text (`MRN 4815162342`, `?mrn=4815162342`) | Masked | Masked | Not masked |
| Values of JSON keys holding page context (`page_title`, `page_path`, `page_search`, `referrer`) | Masked | Not masked | Not masked |
| Any web URL in a tool result | Query string and fragment removed; in the path, record numbers (5+ digits), GUIDs, long hex ids and email addresses become `:id` / `:email` | Each query value replaced with `[masked]`; the path is kept | Sent as is |
| A tab or page as the tab and page tools describe it, and the page's name at the top of a page read | Tab id and origin only: no title, no path | Title and URL with masked query values | Sent as is |
| Values typed or chosen in form fields | Not sent | Replaced with `[masked]` | Sent as is |

How credentials are matched:

- **Header lines in text.** A line that starts with `Authorization`,
  `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` or
  `X-Auth-Token` and a colon loses the rest of the line.
- **Credential words in text.** A value written after a key whose name
  contains `password`, `passwd`, `pwd`, `token`, `secret`, `auth`,
  `session`, `api-key` (or `api_key`, `apikey`), `csrf`, `xsrf`, `jwt`,
  `credential`, `signature`, `private-key` (or `private_key`), `otp` or
  `bearer` is masked: `password=…`, `csrf_token: …`, `"authToken":"…"`.
  JSON held inside a string, such as a response body, counts as text.
- **JSON keys** of the tool result itself are matched by exact name,
  ignoring case and punctuation (`apiKey` matches `api_key`, `X-Api-Key`
  matches `x_api_key`): `token`, `id_token`, `access_token`,
  `x_access_token`, `refresh_token`, `auth_token`, `authorization_token`,
  `private_token`, `session_token`, `x_amz_security_token`, `csrf_token`,
  `x_csrf_token`, `xsrf_token`, `x_xsrf_token`, `api_key`, `x_api_key`,
  `x_auth_token`, `secret`, `client_secret`, `password`, `passwd`, `pwd`,
  `private_key`, `signature`, `credential`, `cookie`, `set_cookie`, `jwt`,
  `otp`, `bearer`, `authorization`, `proxy_authorization`, `session_id`,
  `x_session_id`, `user_session_id`. Other keys are not masked by their
  name, even ones that look like a credential, such as `session`.

Size does not change this: a JSON tool result over 100,000 characters is
masked the same way in each mode. A response body read from the Apty Client
is masked as text by the tool before it becomes a tool result, at any size
(one over 100,000 characters value by value when it is JSON), so `password`
and `token` values in it are masked in Off too.

What no mode hides:

- **Page text is sent as the page shows it in every mode.** A patient's
  name, record number, date of birth or diagnosis written as text on the
  page, or in a link label, reaches the AI provider when a tool reads the
  page. Redaction masks values by the key they sit under or by their
  shape, never by meaning, so it cannot recognise these in prose (a
  record number labelled `MRN` is the one exception).
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
| Conversations, each with the hostname of the http(s) page the panel was on when it was first saved (never its URL, path, query or title; none for other pages or for chats saved before it was recorded), shown in the menu's recent chats | The extension's IndexedDB | Deleted after 7 days without use; at most 5 are kept |
| The agent's history of each conversation (including raw tool results, before masking) | The extension's IndexedDB | Deleted with its conversation: by age, by the 5-conversation limit, when you delete the conversation from the menu's recent chats, or by "New chat". History with no saved conversation (a side panel closed mid-chat) is deleted after a day |
| Screenshots | The extension's IndexedDB | Deleted after 7 days without use; at most 50 are kept |
| Evidence and investigations from the current session | `chrome.storage.session` | Cleared when the browser closes |
| Remembered approvals ("Allow on this site for 15 min") | `chrome.storage.local` | 15 minutes, or until revoked |

**Settings → General → Stored conversations and screenshots → Delete stored
data now** removes conversations, the agent's history and screenshots at
once. Web pages and
other extensions can't read any of this: storage is locked to the
extension's own pages and service worker.

## DOM Config

DOM Config (the DOM config page in the side panel) reads the
pages you capture and proposes Apty DOM settings. All of it happens in the
side panel:

- **Held in memory only.** One capture: for each run of each page, the
  attribute names and values with their counts, tag counts, the elements
  behind high z-index values, each frame's `src`, shadow hosts and the
  page's URL as a shape (record numbers and query values removed). The
  report built from it, your include and exclude choices and your coverage
  marks are held next to it. Nothing is written to storage; closing the
  side panel or **Clear results** removes it all, and a new crawl replaces it.
- **Nothing leaves the browser unless you send it.** DOM Config sends
  nothing to your AI provider, the Apty Client, the MCP daemon or any
  server on its own. **Ask about these** puts the Markdown export (the
  rules you left included, redacted as a tool result is in your
  redaction mode) in a new chat as a chip you can remove; it goes to your
  AI provider only when you press Send. Copies and exports happen only
  when you click.
- **Page names are typed by you.** A page you capture by hand or import is
  named in a field you fill in; the name is never read from the page, and
  page titles are never recorded. A crawled page is named by its URL
  shape.
- **Markdown and JSON exports, Copy.** The proposed rules (only the ones
  you left included), settings, iframes, coverage and warnings. Example
  values in a rule are page data, kept only when they are
  identifier-shaped. Email addresses, phone numbers and digit runs are
  hidden by the engine in the report, the page detail and every export
  (`[PII value hidden]`). Person names have
  no shape and are not detected: a name that changed between two runs can
  appear in that page's list of differences, which the JSON export and the
  page detail include; it never reaches a rule, an example, the Markdown
  or Copy all.
- **Download raw profile** (page detail, per run) saves the run exactly as
  captured: every attribute value of the page, which can include names,
  record numbers and other patient or customer data. The panel asks you to
  confirm before it saves the file.

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
