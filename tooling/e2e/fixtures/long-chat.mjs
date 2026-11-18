/**
 * A stored chat of `turns` turns for the scrolling suite (KB-RAG K27, U1):
 * each turn mixes what makes a chat heavy, in the panel's own storage
 * format (`ConversationData`): KB cards, tool calls, a 40,000-character
 * response, "Why this answer" and "Show thinking details". Synthetic data.
 */
const DECISION = {
  route: "kb",
  version: "4.x",
  versionSource: "files",
  packs: [{ version: "4.x", sha256: "0123456789ab" }],
  kb: { kind: "answer", status: "ok", pageIds: ["101"] },
};

const kbResult = (n) => ({
  status: "ok",
  source: "kb",
  cards: [{ pageId: "101", layer: 1 }],
  mixedVersions: false,
  results: [
    {
      cite: "kb://101#L1",
      title: `FIXTURE banner never glows ${n}`,
      site: "fixture.atlassian.invalid",
      space: "FX",
      aptyVersion: "4.x",
      layer: 1,
      heading: "Layer 1: FIXTURE",
      verifiedOn: "Verified on: FIXTURE.",
      notVerified: n % 3 === 0,
      score: 2,
      text: `- In Studio, turn on the FIXTURE Glowing Banner setting (${n}).`,
    },
  ],
});

const BIG = {
  items: Array.from({ length: 37 }, (_, i) => ({
    id: `fixture-${i}`,
    name: `FIXTURE flow ${i}`,
    body: "x".repeat(1000),
  })),
};

function turn(n) {
  const at = 1_700_000_000_000 + n * 1000;
  const messages = [
    {
      id: `u-${n}`,
      role: "user",
      timestamp: at,
      parts: [
        { type: "text", text: `FIXTURE question ${n}: the banner never glows` },
      ],
    },
  ];
  if (n % 2 === 0) {
    messages.push({
      id: `a-${n}-step`,
      role: "assistant",
      timestamp: at + 1,
      parts: [
        {
          type: "tool",
          toolName: "get_apty_widget_diagnostics",
          toolCallId: `t-${n}`,
          input: {},
          output: n % 10 === 0 ? BIG : { status: "ok", loaded: true },
          state: "completed",
        },
      ],
    });
  }
  messages.push({
    id: `a-${n}`,
    role: "assistant",
    timestamp: at + 2,
    decision: DECISION,
    parts: [
      {
        type: "tool",
        toolName: "search_kb",
        toolCallId: `k-${n}`,
        input: { query: "banner never glows", topK: 3 },
        output: kbResult(n),
        state: "completed",
      },
      {
        type: "text",
        text: `RESULT ${n}: turn on the Glowing Banner setting (kb://101#L1).\n\n- one\n- two\n\n\`\`\`js\nconsole.log(${n});\n\`\`\``,
      },
    ],
  });
  return messages;
}

/** A tool call as a saved chat keeps it: a tool_use part and its tool_result. */
function stored(part) {
  if (part.type !== "tool") return [part];
  return [
    {
      type: "tool_use",
      id: part.toolCallId,
      name: part.toolName,
      input: part.input,
    },
    {
      type: "tool_result",
      tool_use_id: part.toolCallId,
      content: JSON.stringify(part.output),
    },
  ];
}

export function longChat(turns = 300) {
  return {
    id: `conv_e2e_long_${turns}`,
    title: `FIXTURE long chat of ${turns} turns`,
    messages: Array.from({ length: turns }, (_, n) => turn(n))
      .flat()
      .map((message) => ({ ...message, parts: message.parts.flatMap(stored) })),
  };
}
