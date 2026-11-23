/**
 * A stored chat of three KB answers of three cards each, for the panel
 * layout suite (KB-RAG K29, L5), in the panel's own storage format.
 * Synthetic data.
 */
const CARDS = [
  ["101", "FIXTURE banner never glows"],
  ["102", "FIXTURE banner glows for some users"],
  ["103", "FIXTURE banner glows late"],
];

const DECISION = {
  route: "kb",
  version: "4.x",
  versionSource: "files",
  packs: [{ version: "4.x", sha256: "0123456789ab" }],
  kb: { kind: "answer", status: "ok", pageIds: CARDS.map(([id]) => id) },
};

const step = (n, i) =>
  `- In Studio, check FIXTURE setting ${i + 1} of answer ${n} and save it.`;

function kbResult(n) {
  return {
    status: "ok",
    source: "kb",
    cards: CARDS.map(([pageId]) => ({ pageId, layer: 1 })),
    mixedVersions: false,
    results: CARDS.map(([pageId, title], c) => ({
      cite: `kb://${pageId}#L1`,
      title: `${title} ${n}`,
      site: "fixture.atlassian.invalid",
      space: "FX",
      aptyVersion: "4.x",
      layer: 1,
      heading: "Layer 1: FIXTURE",
      verifiedOn: "Verified on: FIXTURE.",
      notVerified: false,
      score: 3 - c,
      text: [0, 1, 2].map((i) => step(n, i)).join("\n"),
    })),
  };
}

function turn(n) {
  const at = 1_700_000_000_000 + n * 1000;
  return [
    {
      id: `u-${n}`,
      role: "user",
      timestamp: at,
      parts: [{ type: "text", text: `FIXTURE question ${n}: the banner` }],
    },
    {
      id: `a-${n}`,
      role: "assistant",
      timestamp: at + 2,
      decision: DECISION,
      parts: [
        {
          type: "tool_use",
          id: `k-${n}`,
          name: "search_kb",
          input: { query: "banner never glows", topK: 3 },
        },
        {
          type: "tool_result",
          tool_use_id: `k-${n}`,
          content: JSON.stringify(kbResult(n)),
        },
        {
          type: "text",
          text: `ANSWER ${n}: check the FIXTURE settings (kb://101#L1).`,
        },
      ],
    },
  ];
}

export function kbAnswers(turns = 3) {
  return {
    id: `conv_e2e_kb_answers_${turns}`,
    title: `FIXTURE ${turns} KB answers`,
    messages: Array.from({ length: turns }, (_, n) => turn(n)).flat(),
  };
}
