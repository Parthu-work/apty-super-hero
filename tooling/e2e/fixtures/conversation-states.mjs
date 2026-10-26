/**
 * A stored chat holding every conversation state a saved chat can keep: a
 * Markdown answer with headings, a list, inline code, a code block, a wide
 * table and a link; tool calls pending, failed and completed; and a turn
 * the provider refused (bad key). It is written in the panel's own storage
 * format (`ConversationData` in apty-conversations-db), so no test hook is
 * needed. A running tool call, context chips and sources are not stored.
 */

const ANSWER = [
  "## What I checked",
  "",
  "The **Submit order** button is enabled, and nothing blocks the click.",
  "",
  "### Selectors",
  "",
  "- `#submit` has no `disabled` attribute.",
  "- The form has two fields.",
  "",
  "| Selector | Matches | Visible |",
  "| --- | --- | --- |",
  "| `#submit` | 1 | yes |",
  "| `form button[type=submit].primary-action-with-a-long-class-name` | 1 | yes |",
  "",
  "```js",
  "document.querySelector('#submit').click();",
  "```",
  "",
  "See [the selector guide](https://example.com/guide).",
].join("\n");

const call = (id, name) => ({
  type: "tool_use",
  id,
  name,
  input: { selector: "#submit" },
});

export const CONVERSATION_STATES = {
  id: "conv_e2e_states",
  title: "Why can't I click Submit order?",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Why can't I click Submit order?" }],
    },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: ANSWER }] },
    {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "Check the button again." }],
    },
    {
      id: "a2",
      role: "assistant",
      parts: [
        call("call-1", "search_elements"),
        call("call-2", "analyze_element_selectors"),
        {
          type: "tool_result",
          tool_use_id: "call-2",
          content: "Tab 7 was closed before the analysis finished.",
          is_error: true,
        },
        call("call-3", "click_element"),
        {
          type: "tool_result",
          tool_use_id: "call-3",
          content: JSON.stringify({ clicked: true, selector: "#submit" }),
        },
        { type: "text", text: "The click went through." },
      ],
    },
    { id: "u3", role: "user", parts: [{ type: "text", text: "And now?" }] },
    {
      id: "a3",
      role: "assistant",
      parts: [],
      error: {
        kind: "badKey",
        message: "401 Incorrect API key provided: sk-e2e-***",
      },
    },
  ],
};
