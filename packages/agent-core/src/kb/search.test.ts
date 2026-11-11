import { describe, expect, it } from "vitest";
import {
  encodeVectors,
  type SyntheticCard,
  syntheticPack,
} from "./kb-test-utils.js";
import { createKbIndex, layerHint } from "./search.js";
import { KB_SYNONYM_GROUPS } from "./synonyms.js";

function card(
  pageId: string,
  title: string,
  layers: [string, string, string, string],
): SyntheticCard {
  return { pageId, title, layers };
}

const SEND = "- Send support: the FIXTURE version and a screenshot.";
const CARDS = [
  card("101", "FIXTURE banner never glows", [
    "- In Studio, turn on the FIXTURE Glowing Banner setting.",
    "- The FIXTURE banner slot must be on the page.",
    "- NOT VERIFIED: glow.json lists glowIds (FIXTURE).",
    `- Contact support when the banner still does not glow.\n${SEND}`,
  ]),
  card("202", "FIXTURE tooltip opens twice", [
    "- In Studio, clear the FIXTURE Double Trigger setting.",
    "- The FIXTURE anchor element must be unique on the page.",
    "- tooltip.json lists triggerCount (FIXTURE).",
    `- Contact support when it still opens twice.\n${SEND}`,
  ]),
  card("303", "FIXTURE survey is blank", [
    "- In Admin, set the FIXTURE Survey Locale for the user's language.",
    "- The FIXTURE survey frame must load.",
    "- survey.json lists questions per locale (FIXTURE).",
    `- Contact support when the survey stays blank.\n${SEND}`,
  ]),
];

const ids = (result: ReturnType<ReturnType<typeof createKbIndex>["search"]>) =>
  result.hits.map((hit) => hit.chunk.id);

describe("createKbIndex search", () => {
  const index = createKbIndex(syntheticPack(CARDS));

  it("ranks the card whose title matches first, and the layer that holds the words", () => {
    const result = index.search("banner does not glow");
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.chunk.pageId).toBe("101");
    expect(index.search("Double Trigger setting").hits[0]?.chunk.id).toBe(
      "202#L1",
    );
    expect(index.search("triggerCount").hits[0]?.chunk.id).toBe("202#L3");
  });

  it("matches a prefix and a small typo", () => {
    expect(index.search("tooltp opens").hits[0]?.chunk.pageId).toBe("202");
    expect(index.search("surv").hits[0]?.chunk.pageId).toBe("303");
  });

  it("gives the same ranking every time, for the same pack and query", () => {
    const again = createKbIndex(syntheticPack(CARDS));
    for (const query of ["FIXTURE setting", "page", "contact"]) {
      expect(again.search(query, { topK: 10 })).toEqual(
        index.search(query, { topK: 10 }),
      );
    }
  });

  it("breaks ties by page id, then layer", () => {
    const same = "- FIXTURE identical words here.";
    const twins = createKbIndex(
      syntheticPack([
        card("20", "FIXTURE twin", [same, same, "- other one", "- other two"]),
        card("3", "FIXTURE twin", [same, same, "- other one", "- other two"]),
      ]),
    );
    expect(ids(twins.search("identical words", { topK: 4 }))).toEqual([
      "3#L1",
      "3#L2",
      "20#L1",
      "20#L2",
    ]);
  });

  it("keeps only the layers asked for", () => {
    const result = index.search("FIXTURE setting", { layers: [3], topK: 5 });
    expect(result.hits.every((hit) => hit.chunk.layer === 3)).toBe(true);
    expect(index.search("Double Trigger", { layers: [2] }).status).toBe(
      "not_covered",
    );
  });

  it("does not match on boilerplate every card shares", () => {
    expect(index.search("screenshot").status).toBe("not_covered");
    expect(index.search("verified").status).toBe("not_covered");
    expect(index.search("network data to look at").status).toBe("not_covered");
  });

  it("caps topK, and keeps one chunk per card when asked", () => {
    expect(index.search("FIXTURE", { topK: 2 }).hits).toHaveLength(2);
    expect(index.search("FIXTURE", { topK: 0 }).hits).toHaveLength(1);
    const cards = index.search("FIXTURE", { topK: 10, onePerCard: true });
    expect(cards.hits.map((hit) => hit.chunk.pageId)).toEqual([
      ...new Set(cards.hits.map((hit) => hit.chunk.pageId)),
    ]);
    expect(cards.hits).toHaveLength(3);
  });

  it("is not covered when nothing matches, or the top score is below the pack's threshold", () => {
    expect(index.search("kubernetes helm chart")).toEqual({
      status: "not_covered",
      hits: [],
      coverage: 0,
      reason: "no_match",
    });
    const top = index.search("banner does not glow").hits[0]?.score ?? 0;
    const strict = createKbIndex(syntheticPack(CARDS, { threshold: top + 1 }));
    expect(strict.info.calibrated).toBe(true);
    expect(strict.search("banner does not glow").status).toBe("not_covered");
    const lenient = createKbIndex(syntheticPack(CARDS, { threshold: top }));
    const kept = lenient.search("banner does not glow", { topK: 10 });
    expect(kept.status).toBe("ok");
    expect(kept.hits.every((hit) => hit.score >= top)).toBe(true);
  });

  it("indexes each (page, layer) once and reads a card's chunks by layer", () => {
    const pack = syntheticPack(CARDS.slice(0, 1));
    const duplicated = {
      ...pack,
      chunks: [...pack.chunks, { ...pack.chunks[0], text: "- FIXTURE copy" }],
    } as typeof pack;
    const once = createKbIndex(duplicated);
    expect(once.info).toEqual({
      aptyVersions: ["5.x"],
      cardCount: 1,
      stubCount: 0,
      chunkCount: 4,
      mode: "bm25",
      calibrated: false,
    });
    expect(once.search("copy").status).toBe("not_covered");
    expect(once.cardChunks("101").map((chunk) => chunk.layer)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(once.cardChunks("999")).toEqual([]);
    expect(once.card("101")?.title).toBe("FIXTURE banner never glows");
  });
});

describe("untrusted headings", () => {
  it("indexes a heading with a very long run of whitespace in linear time", () => {
    const heading = `Layer 1: x${"\t".repeat(200_000)}y`;
    const started = performance.now();
    const index = createKbIndex(
      syntheticPack([
        {
          ...CARDS[0],
          headings: [heading, heading, heading, heading],
        } as SyntheticCard,
      ]),
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(index.search("banner").status).toBe("ok");
  });
});

describe("hybrid ranking", () => {
  // 202#L1 points the same way as the query; 303#L1 nearly; the rest away.
  const vectors = CARDS.flatMap((c) =>
    [1, 2, 3, 4].map((layer) =>
      layer !== 1
        ? [0, 1]
        : c.pageId === "202"
          ? [1, 0]
          : c.pageId === "303"
            ? [0.95, 0.312]
            : [0, 1],
    ),
  );
  const pack = syntheticPack(
    CARDS,
    { dense: { model: "FIXTURE-model", dims: 2, threshold: 0.9 } },
    { vectors: encodeVectors(vectors) },
  );
  const index = createKbIndex(pack);
  const queryVector = new Float32Array([1, 0]);

  it("covers a query only the dense ranking matches", () => {
    expect(index.info.mode).toBe("hybrid");
    expect(index.search("kubernetes").status).toBe("not_covered");
    const dense = index.search("kubernetes", { queryVector, topK: 5 });
    expect(ids(dense)).toEqual(["202#L1", "303#L1"]);
  });

  it("fuses the keyword and dense rankings by reciprocal rank", () => {
    const keywordOnly = index.search("survey blank", { topK: 5 });
    expect(keywordOnly.hits.every((hit) => hit.chunk.pageId === "303")).toBe(
      true,
    );
    const fused = index.search("survey blank", { queryVector, topK: 2 });
    expect(ids(fused)).toEqual(["303#L1", "202#L1"]);
    expect(fused.hits[1]?.score).toBeCloseTo(1 / 61);
  });
});

const V2 = { schemaVersion: 2 } as const;
const WIDGET_CARDS = [
  card("101", "FIXTURE banner never glows in the widget", [
    "- In Studio, turn on the FIXTURE Glowing Banner setting for the widget.",
    "- The FIXTURE banner slot must be on the page next to the widget.",
    "- glow.json lists glowIds for the widget (FIXTURE).",
    "- Contact support when the widget banner still does not glow.",
  ]),
  card("202", "FIXTURE tooltip opens twice in the widget", [
    "- In Studio, clear the FIXTURE Double Trigger setting in the widget.",
    "- The FIXTURE anchor element must be unique for the widget.",
    "- tooltip.json lists triggerCount for the widget (FIXTURE).",
    "- Contact support when the widget tooltip still opens twice.",
  ]),
  card("303", "FIXTURE survey is blank in the widget", [
    "- In Admin, set the FIXTURE Survey Locale for the widget user's language.",
    "- The FIXTURE survey frame must load inside the widget.",
    "- survey.json lists questions per locale for the widget (FIXTURE).",
    "- Contact support when the widget survey stays blank.",
  ]),
  card("404", "FIXTURE checklist progress resets in the widget", [
    "- In Admin, turn on FIXTURE Remember Progress for the widget checklist.",
    "- Local storage must keep the FIXTURE progress key for the widget.",
    "- progress.json lists completedSteps for the widget (FIXTURE).",
    "- Contact support when the widget checklist still resets.",
  ]),
];

describe("coverage (schema v2)", () => {
  const index = createKbIndex(syntheticPack(WIDGET_CARDS, {}, V2));

  it("does not cover a long off-topic question that a short covered one beats", () => {
    const long = index.search(
      "our kubernetes cluster keeps restarting the pod with CrashLoopBackOff after the helm upgrade so the payroll dashboard times out for managers in every region overnight",
    );
    expect(long).toMatchObject({ status: "not_covered", hits: [] });
    expect(long.reason).toBe(long.coverage > 0 ? "low_coverage" : "no_match");
    expect(long.coverage).toBeLessThan(0.5);

    const short = index.search("survey blank");
    expect(short.status).toBe("ok");
    expect(short.hits[0]?.chunk.pageId).toBe("303");
    expect(short.coverage).toBe(1);
  });

  it("names a setting the top card does not have, instead of answering with the card", () => {
    const invented = index.search("where is the Glowing Toggle for the banner");
    expect(invented).toMatchObject({
      status: "not_covered",
      reason: "unknown_setting",
      missingPhrases: ["Glowing Toggle"],
      hits: [],
    });
    const quoted = index.search('banner "glow switch" does not glow');
    expect(quoted.missingPhrases).toEqual(["glow switch"]);

    const real = index.search("where is the Glowing Banner setting");
    expect(real.status).toBe("ok");
    expect(real.hits[0]?.chunk.pageId).toBe("101");
    expect(index.search("Chrome Network tab shows glow.json").reason).not.toBe(
      "unknown_setting",
    );
  });

  it("does not cover a question whose only matched words are in most cards", () => {
    const result = index.search("apty widget");
    expect(result.status).toBe("not_covered");
    expect(result.reason).toBe("low_coverage");
  });

  it("gives the same coverage, to the last digit, every time", () => {
    const again = createKbIndex(syntheticPack(WIDGET_CARDS, {}, V2));
    for (const query of [
      "banner never glows on the payroll page",
      "tooltip opens twice",
      "survey stays blank for French users",
    ]) {
      expect(again.search(query)).toEqual(index.search(query));
      expect(
        Object.is(again.search(query).coverage, index.search(query).coverage),
      ).toBe(true);
    }
  });

  it("uses the pack's calibrated coverage settings", () => {
    const query =
      "banner never glows on the payroll kubernetes dashboard overnight";
    expect(index.search(query).status).toBe("not_covered");
    const lenient = createKbIndex(
      syntheticPack(
        WIDGET_CARDS,
        { coverage: { min: 0.2, minIdf: 0.5, minTerms: 1 } },
        V2,
      ),
    );
    expect(lenient.search(query).status).toBe("ok");
    const strict = createKbIndex(
      syntheticPack(
        WIDGET_CARDS,
        { coverage: { min: 0.5, minIdf: 0.5, minTerms: 3 } },
        V2,
      ),
    );
    expect(strict.search("survey blank").status).toBe("not_covered");
  });

  it("matches a typo from five typed characters, and a prefix only from four", () => {
    expect(index.search("tooltp opens").hits[0]?.chunk.pageId).toBe("202");
    expect(index.search("glowz banner").coverage).toBeLessThan(1);
    expect(index.search("glowz").hits[0]?.chunk.pageId).toBe("101");
    expect(index.search("glox").status).toBe("not_covered");
    expect(index.search("surv").hits[0]?.chunk.pageId).toBe("303");
    expect(index.search("prog").hits[0]?.chunk.pageId).toBe("404");
    expect(index.search("pro").status).toBe("not_covered");
  });
});

function symptomCard(
  pageId: string,
  title: string,
  symptom: string,
  layers: [string, string, string, string],
): SyntheticCard {
  return { pageId, title, symptom, layers };
}

const USER_WORDS = [
  symptomCard(
    "11",
    "FIXTURE badge is the wrong colour",
    "The FIXTURE badge shows grey instead of the brand colour.",
    [
      "- In Studio, pick the FIXTURE Badge Palette.",
      "- The FIXTURE badge element carries a colour class.",
      "- badge.json lists paletteId (FIXTURE).",
      "- Contact support with the FIXTURE badge id.",
    ],
  ),
  symptomCard(
    "12",
    "FIXTURE badge flickers on hover",
    "The FIXTURE marker keeps blinking whenever the mouse passes over it.",
    [
      "- In Studio, turn off FIXTURE Hover Pulse.",
      "- Two FIXTURE hover handlers on the element cause it.",
      "- pulse.json lists pulseRate (FIXTURE).",
      "- Contact support with the FIXTURE pulse id.",
    ],
  ),
  symptomCard(
    "13",
    "FIXTURE tour stops after a page reload",
    "After the user presses reload the FIXTURE tour does not continue.",
    [
      "- In Studio, turn on FIXTURE Resume Tour.",
      "- Session storage must keep the FIXTURE tour key.",
      "- resume.json lists resumeStep (FIXTURE).",
      "- Contact support with the FIXTURE tour id.",
    ],
  ),
  symptomCard(
    "14",
    "FIXTURE flow-ID.json response, what it means",
    "The Network tab lists flow-<id>.json and the user wants to read its answer.",
    [
      "- In Studio, publish the FIXTURE flow before reading flow-ID.json.",
      "- In the Console, the FIXTURE player logs the flow id.",
      "- flow-ID.json holds the FIXTURE steps; a 404 means the flow is not published; [] means it has no steps.",
      "- Send support the FIXTURE flow-ID.json response and its status.",
    ],
  ),
  symptomCard(
    "15",
    "FIXTURE one user cannot see the panel",
    "A single FIXTURE user is missing the panel while colleagues have it.",
    [
      "- In Admin, add the FIXTURE user to the panel group.",
      "- The FIXTURE panel container is hidden for that user.",
      "- panel.json lists groupIds (FIXTURE).",
      "- Contact support with the FIXTURE user id.",
    ],
  ),
  symptomCard(
    "16",
    "FIXTURE panel shows for every user",
    "Everyone sees the FIXTURE panel although it is limited to a group.",
    [
      "- In Admin, turn off FIXTURE Show To All.",
      "- The FIXTURE panel renders before the group check.",
      "- groups.json lists allowAll (FIXTURE).",
      "- Contact support with the FIXTURE group id.",
    ],
  ),
];

describe("what the user says (schema v2)", () => {
  const index = createKbIndex(syntheticPack(USER_WORDS, {}, V2));
  const top = (query: string) =>
    index.search(query, { onePerCard: true, topK: 3 });

  it("ranks first the card whose symptom line, not its title, says it", () => {
    expect(
      top("the badge keeps blinking when the mouse passes").hits[0]?.chunk
        .pageId,
    ).toBe("12");
  });

  it("does not let a shared title word win over the symptom", () => {
    expect(top("everyone can see the panel").hits[0]?.chunk.pageId).toBe("16");
  });

  it("finds a card by another form of its words", () => {
    expect(top("badge flickering").hits[0]?.chunk.pageId).toBe("12");
    expect(top("badge flickered on hover").hits[0]?.chunk.pageId).toBe("12");
  });

  it("finds a card by a synonym, and counts the synonym toward coverage", () => {
    const result = top("the walkthrough halts on refresh");
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.chunk.pageId).toBe("13");
    expect(result.coverage).toBeGreaterThan(0.5);
  });

  it("finds the flow-ID.json card from a numbered or uuid file name", () => {
    for (const name of [
      "flow-123.json",
      "flow-0c000000-0000-7000-8000-000000000002.json",
    ]) {
      const result = top(`what does ${name} tell me`);
      expect(result.status, name).toBe("ok");
      expect(result.hits[0]?.chunk.pageId, name).toBe("14");
    }
  });

  it("ranks layer 3 first for a status code or a file's meaning, layer 1 for a symptom", () => {
    expect(top("flow-ID.json returned 404").hits[0]?.chunk.id).toBe("14#L3");
    expect(
      top("what does the flow-ID.json response mean").hits[0]?.chunk.id,
    ).toBe("14#L3");
    expect(top("badge flickers on hover").hits[0]?.chunk.id).toBe("12#L1");
    expect(
      top("badge flickers, which hover handlers are on the element").hits[0]
        ?.chunk.id,
    ).toBe("12#L2");
  });
});

describe("layerHint", () => {
  it.each([
    ["segments.json returned 403", 3],
    ["what does flow.json mean", 3],
    ["which selector in the Console", 2],
    ["where is the setting in Studio", 1],
    ["who do I contact in support", 4],
    ["the tooltip flickers", 1],
  ] as const)("%s → layer %i", (query, layer) => {
    expect(layerHint(query)).toBe(layer);
  });
});

describe("stub and routing cards (schema v2)", () => {
  const CARDS: SyntheticCard[] = [
    ...USER_WORDS,
    {
      pageId: "17",
      title: "FIXTURE bulk export of gadgets times out",
      symptom: "Exporting many FIXTURE gadgets at once never finishes.",
      status: "stub",
    },
    {
      pageId: "18",
      title: "Start here: FIXTURE panel and badge questions",
      symptom: "Which FIXTURE panel or badge card to read first.",
      status: "routing",
    },
  ];
  const index = createKbIndex(syntheticPack(CARDS, {}, V2));

  it("answers a question only a stub covers with the stub, never another card", () => {
    const result = index.search("bulk export of gadgets never finishes", {
      onePerCard: true,
    });
    expect(result).toMatchObject({ status: "stub", hits: [] });
    expect(result.card?.pageId).toBe("17");
    expect(index.info.stubCount).toBe(1);
  });

  it("never returns a routing card, even when it ranks first", () => {
    const result = index.search("which panel or badge card to read first", {
      onePerCard: true,
      topK: 10,
    });
    expect(result.hits.map((hit) => hit.chunk.pageId)).not.toContain("18");
    expect(result.card).toBeUndefined();
    for (const query of ["panel", "badge", "start here"]) {
      const any = index.search(query, { topK: 20 });
      expect(any.hits.every((hit) => hit.card.status !== "routing")).toBe(true);
      expect(any.status).not.toBe("stub");
    }
  });

  it("answers from a full card when it, not the stub, covers the question", () => {
    const result = index.search("badge flickers on hover", {
      onePerCard: true,
    });
    expect(result.status).toBe("ok");
    expect(result.hits[0]?.chunk.pageId).toBe("12");
  });

  it("F2: a stub never wins on one generic shared word", () => {
    const withShowStub = createKbIndex(
      syntheticPack(
        [
          ...CARDS_FOR_STUB,
          {
            pageId: "19",
            title: "FIXTURE gadget analytics missing in the dashboard",
            symptom: "FIXTURE gadget analytics never show in the reports.",
            status: "stub",
          },
        ],
        { coverage: { min: 0.25, minIdf: 0.5, minTerms: 1 } },
        V2,
      ),
    );
    const generic = withShowStub.search("the doohickey does not show", {
      onePerCard: true,
    });
    expect(generic.status).toBe("not_covered");
    expect(generic.card).toBeUndefined();
    const real = withShowStub.search(
      "gadget analytics missing in the dashboard",
      { onePerCard: true },
    );
    expect(real.status).toBe("stub");
    expect(real.card?.pageId).toBe("19");
  });
});

const CARDS_FOR_STUB: SyntheticCard[] = [
  card("31", "FIXTURE banner never glows", [
    "- In Studio, turn on the FIXTURE Glowing Banner setting.",
    "- The FIXTURE banner slot must be on the page.",
    "- glow.json lists glowIds (FIXTURE).",
    "- Contact support when the banner still does not glow.",
  ]),
  card("32", "FIXTURE survey is blank", [
    "- In Admin, set the FIXTURE Survey Locale for the user's language.",
    "- The FIXTURE survey frame must load.",
    "- survey.json lists questions per locale (FIXTURE).",
    "- Contact support when the survey stays blank.",
  ]),
];

describe("F5: short typos match on the word as typed", () => {
  const index = createKbIndex(
    syntheticPack(
      [
        card("71", "FIXTURE balloon does not appear on the field", [
          "- In Studio, set the FIXTURE Balloon Trigger to focus.",
          "- The FIXTURE field must be on the page.",
          "- flow.json lists triggerType (FIXTURE).",
          "- Send support the FIXTURE balloon id.",
        ]),
        card("72", "FIXTURE survey is blank", [
          "- In Admin, set the FIXTURE Survey Locale.",
          "- The FIXTURE survey frame must load.",
          "- survey.json lists questions per locale (FIXTURE).",
          "- Send support the FIXTURE survey id.",
        ]),
      ],
      { coverage: { min: 0.35, minIdf: 0.5, minTerms: 1 } },
      V2,
    ),
  );

  it("finds the card through a typo whose stem is shorter than the word typed", () => {
    for (const query of [
      "FIXTURE baloon does not apear",
      "the balloon is not apearing on the FIXTURE field",
    ]) {
      const result = index.search(query, { onePerCard: true });
      expect(result.status, query).toBe("ok");
      expect(result.hits[0]?.chunk.pageId, query).toBe("71");
    }
  });

  it("weighs a typo-only match 0.5 in coverage, as in ranking", () => {
    expect(index.search("baloon").coverage).toBeCloseTo(0.5, 10);
    expect(index.search("balloon").coverage).toBe(1);
  });

  it("never fuzzy-matches a word of four letters or fewer, or a word the cards hold", () => {
    expect(index.search("baln").status).toBe("not_covered");
    expect(index.search("kubernetes pod CrashLoopBackOff").status).toBe(
      "not_covered",
    );
  });
});

/** F7: [group, question using a member in its ordinary sense, the group's card, the card the question is about]. */
const COLLISIONS: [string, string, string, string][] = [
  [
    "balloon",
    "the browser blocks the popup window for payroll",
    "FIXTURE balloon flickers on hover",
    "FIXTURE browser blocks the payroll window",
  ],
  [
    "workflow",
    "the approval flow in our ERP sends no email",
    "FIXTURE walkthrough stops after reload",
    "FIXTURE ERP approval sends no email",
  ],
  [
    "reload",
    "I pressed refresh on the report and its numbers are stale",
    "FIXTURE tour stops after a reload",
    "FIXTURE report numbers are stale",
  ],
  [
    "production",
    "the live chat vendor script fails",
    "FIXTURE widget missing in production",
    "FIXTURE chat vendor script fails",
  ],
  [
    "test",
    "the qa team cannot log in to jira",
    "FIXTURE widget works in uat only",
    "FIXTURE team cannot log in to jira",
  ],
  [
    "freeze",
    "the salary freeze letter template is missing",
    "FIXTURE player hangs the page",
    "FIXTURE salary letter template missing",
  ],
  [
    "crash",
    "out of memory errors in our database server",
    "FIXTURE tab crashed with the player",
    "FIXTURE database server errors",
  ],
  [
    "slow",
    "the performance review form will not submit",
    "FIXTURE widget is sluggish",
    "FIXTURE review form will not submit",
  ],
  [
    "disappear",
    "missing invoices in the finance report",
    "FIXTURE beacon vanishes",
    "FIXTURE finance report invoices",
  ],
  [
    "repeat",
    "I tried again and the export failed",
    "FIXTURE checklist repeats",
    "FIXTURE export failed",
  ],
  [
    "language",
    "the french keyboard layout types wrong letters",
    "FIXTURE survey untranslated",
    "FIXTURE keyboard layout types wrong letters",
  ],
  [
    "split step",
    "the git branch cannot be merged",
    "FIXTURE decision step goes the wrong way",
    "FIXTURE git cannot be merged",
  ],
  [
    "launcher",
    "the save button on the form is disabled",
    "FIXTURE launcher missing after publish",
    "FIXTURE save form disabled",
  ],
  [
    "segment",
    "the audience of the town hall meeting",
    "FIXTURE segment ignores the user group",
    "FIXTURE town hall meeting",
  ],
  [
    "publish",
    "the release notes page is empty",
    "FIXTURE content missing after publish",
    "FIXTURE notes page is empty",
  ],
  [
    "selector",
    "the css file of our intranet theme is huge",
    "FIXTURE xpath matches nothing",
    "FIXTURE intranet theme file is huge",
  ],
  [
    "csp",
    "the nonce in the oauth request is reused",
    "FIXTURE content-security-policy blocks the player",
    "FIXTURE oauth request reused",
  ],
  [
    "cors",
    "the vendor api refuses cross-origin calls from the mobile app",
    "FIXTURE cors blocks the player",
    "FIXTURE vendor api mobile app calls",
  ],
  [
    "iframe",
    "the embedded video in the newsletter does not play",
    "FIXTURE iframe hides the player",
    "FIXTURE newsletter video does not play",
  ],
  [
    "shadow dom",
    "the lwc developer certification exam",
    "FIXTURE shadow root hides the element",
    "FIXTURE developer certification exam",
  ],
  [
    "skip",
    "jump to the next chapter of the training video",
    "FIXTURE flow skips a step",
    "FIXTURE training video next chapter",
  ],
  [
    "widget",
    "the weather widget on the intranet home page is blank",
    "FIXTURE help panel is empty",
    "FIXTURE weather on the intranet home is blank",
  ],
];

describe("F7: synonym groups that do not collide", () => {
  const index = createKbIndex(
    syntheticPack(
      COLLISIONS.flatMap(([, , group, about], i) =>
        [group, about].map((title, j) =>
          card(String(900 + i * 2 + j), title, [
            `- In Studio, check the setting for: ${title}.`,
            `- The element for: ${title}.`,
            `- data.json lists: ${title}.`,
            `- Send support the id for: ${title}.`,
          ]),
        ),
      ),
      { coverage: { min: 0.35, minIdf: 0.5, minTerms: 1 } },
      V2,
    ),
  );

  it("covers every synonym group", () => {
    const named = new Set(COLLISIONS.map(([group]) => group));
    for (const group of KB_SYNONYM_GROUPS) {
      expect(
        group.some((member) => named.has(member)),
        group.join(","),
      ).toBe(true);
    }
  });

  it.each(
    COLLISIONS.map(([group, q], i) => [group, q, i] as const),
  )("%s: %s does not rank the group's card first", (_group, q, i) => {
    const result = index.search(q, { onePerCard: true });
    expect(result.hits[0]?.chunk.pageId).not.toBe(String(900 + i * 2));
  });

  it('the required cases: a help icon is the widget, and a bare "again" is no repeat', () => {
    const small = createKbIndex(
      syntheticPack(
        [
          card("951", "FIXTURE launcher missing after publish", [
            "- In Studio, assign the FIXTURE launcher before publishing.",
            "- The FIXTURE launcher container must be on the page.",
            "- launcher.json lists the FIXTURE launcher ids.",
            "- Send support the FIXTURE launcher id.",
          ]),
          card("952", "FIXTURE widget is empty", [
            "- In Admin, assign content to the FIXTURE widget.",
            "- The FIXTURE widget container must be on the page.",
            "- widget.json lists the FIXTURE widget items.",
            "- Send support the FIXTURE widget id.",
          ]),
          card("953", "FIXTURE checklist repeats at each login", [
            "- In Admin, turn on FIXTURE Remember Completion.",
            "- Local storage must keep the FIXTURE completion key.",
            "- progress.json lists the FIXTURE completed steps.",
            "- Send support the FIXTURE checklist id.",
          ]),
        ],
        { coverage: { min: 0.35, minIdf: 0.5, minTerms: 1 } },
        V2,
      ),
    );
    const top = (q: string) => small.search(q, { onePerCard: true });
    expect(top("the help icon is gone").hits[0]?.chunk.pageId).toBe("952");
    expect(top("I tried it again").hits[0]?.chunk.pageId).not.toBe("953");
    expect(top("the checklist shows again").hits[0]?.chunk.pageId).toBe("953");
  });
});

describe("K24-2: context words count only when the card holds them", () => {
  const CONTEXT_CARDS = [
    card("901", "FIXTURE balloon missing on the field", [
      "- In Studio, set the FIXTURE Balloon Trigger to focus.",
      "- The FIXTURE field must hold the balloon anchor.",
      "- balloon.json lists triggerType (FIXTURE).",
      "- Send support the FIXTURE balloon id.",
    ]),
    card("902", "FIXTURE flow skips a step", [
      "- In Studio, check the FIXTURE Step Order.",
      "- The FIXTURE step anchor must be unique.",
      "- flow.json lists steps (FIXTURE).",
      "- Send support the FIXTURE flow id.",
    ]),
    card("903", "FIXTURE player freezes the page", [
      "- In Admin, lower the FIXTURE Player Polling setting.",
      "- The FIXTURE page must not reload the player.",
      "- player.json lists pollMs (FIXTURE).",
      "- Send support the FIXTURE player log.",
    ]),
    card("904", "FIXTURE widget survey is blank", [
      "- In Admin, set the FIXTURE Survey Locale.",
      "- The FIXTURE survey frame must load.",
      "- survey.json lists questions per locale (FIXTURE).",
      "- Send support the FIXTURE survey id.",
    ]),
    card("905", "FIXTURE hint is cropped", [
      "- In Studio, set the FIXTURE Hint Width.",
      "- The FIXTURE hint container must not clip.",
      "- hint.json lists width (FIXTURE).",
      "- Send support a FIXTURE screenshot.",
    ]),
  ];
  const index = createKbIndex(
    syntheticPack(
      CONTEXT_CARDS,
      { coverage: { min: 0.35, minIdf: 0.5, minTerms: 1 } },
      V2,
    ),
  );
  const search = (query: string) => index.search(query, { onePerCard: true });

  it("covers a covered symptom when the question also names the application and the place", () => {
    const plain = search("FIXTURE balloon missing");
    expect(plain.status).toBe("ok");
    expect(plain.hits[0]?.chunk.pageId).toBe("901");
    for (const query of [
      "FIXTURE balloon missing on the ServiceNow incident form",
      "Salesforce Lightning page, FIXTURE balloon missing",
      "FIXTURE balloon missing on the SuccessFactors page",
    ]) {
      const result = search(query);
      expect(result.status, query).toBe("ok");
      expect(result.hits[0]?.chunk.pageId, query).toBe("901");
      expect(result.coverage, query).toBeGreaterThanOrEqual(plain.coverage);
    }
    const workday = search(
      "FIXTURE balloon does not appear on the field in Workday",
    );
    expect(workday.status).toBe("ok");
    expect(workday.hits[0]?.chunk.pageId).toBe("901");
    expect(workday.coverage).toBe(
      search("FIXTURE balloon does not appear on the field").coverage,
    );
  });

  it("keeps off-topic questions, with or without an application name, not covered", () => {
    for (const query of [
      "kubernetes pod CrashLoopBackOff",
      "how do I configure SAML SSO",
      "Salesforce licence price for 50 users",
      "Workday payroll tax rules",
      "chrome is not opening on my laptop",
    ]) {
      expect(search(query).status, query).toBe("not_covered");
    }
    expect(search("kubernetes pod CrashLoopBackOff").reason).toBe("no_match");
    expect(search("where is the Widget Activation toggle")).toMatchObject({
      status: "not_covered",
      reason: "unknown_setting",
    });
  });

  it("lists exactly the context words it left out, and none the card holds", () => {
    expect(
      search("FIXTURE balloon missing on the ServiceNow incident form")
        .contextIgnored,
    ).toEqual(["servicenow", "incident", "form"]);
    expect(
      search("Salesforce Lightning page, FIXTURE balloon missing")
        .contextIgnored,
    ).toEqual(["salesforc", "lightn", "pag"]);
    const held = search("FIXTURE player freezes the page in Workday");
    expect(held.hits[0]?.chunk.pageId).toBe("903");
    expect(held.contextIgnored).toEqual(["workday"]);
    expect(search("FIXTURE balloon missing").contextIgnored).toBeUndefined();
  });

  it("gives a left-out context word no weight at all: coverage is that of the question without it", () => {
    expect(
      search("FIXTURE balloon missing on the ServiceNow incident form")
        .coverage,
    ).toBe(search("FIXTURE balloon missing").coverage);
  });

  it("counts a context word as before when the card matches nothing of the question's own topic exactly", () => {
    const launcher = createKbIndex(
      syntheticPack(
        [
          ...CONTEXT_CARDS,
          card("908", "FIXTURE launcher button missing", [
            "- In Studio, turn on the FIXTURE Launcher Icon.",
            "- The FIXTURE launcher slot must be visible.",
            "- launcher.json lists iconUrl (FIXTURE).",
            "- Send support the FIXTURE launcher id.",
          ]),
        ],
        { coverage: { min: 0.6, minIdf: 1, minTerms: 1 } },
        V2,
      ),
    );
    const ordinary = launcher.search(
      "the FIXTURE button on the form is disabled",
      {
        onePerCard: true,
      },
    );
    expect(ordinary.status).toBe("not_covered");
    expect(ordinary.contextIgnored).toBeUndefined();
  });

  it("is no_match when the only words are context words no card holds", () => {
    expect(search("ServiceNow incident form")).toMatchObject({
      status: "not_covered",
      reason: "no_match",
      coverage: 0,
    });
  });

  it("credits a card that names the application over an otherwise equal card that does not", () => {
    const twins = createKbIndex(
      syntheticPack(
        [
          ...CONTEXT_CARDS,
          card("906", "FIXTURE launcher icon missing", [
            "- In Studio, turn on the FIXTURE Launcher Icon.",
            "- The FIXTURE launcher slot must be visible.",
            "- launcher.json lists iconUrl (FIXTURE).",
            "- Send support the FIXTURE launcher id.",
          ]),
          card("907", "FIXTURE launcher icon missing", [
            "- In Studio, turn on the FIXTURE Launcher Icon in Workday.",
            "- The FIXTURE launcher slot must be visible.",
            "- launcher.json lists iconUrl (FIXTURE).",
            "- Send support the FIXTURE launcher id.",
          ]),
        ],
        { coverage: { min: 0.35, minIdf: 0.5, minTerms: 1 } },
        V2,
      ),
    );
    const result = twins.search("FIXTURE launcher icon missing in Workday", {
      onePerCard: true,
    });
    expect(result.status).toBe("ok");
    expect(result.hits.map((hit) => hit.chunk.pageId).slice(0, 2)).toEqual([
      "907",
      "906",
    ]);
    expect(result.coverage).toBe(1);
    expect(result.contextIgnored).toBeUndefined();

    const withoutName = createKbIndex(
      syntheticPack(
        CONTEXT_CARDS.concat(
          card("906", "FIXTURE launcher icon missing", [
            "- In Studio, turn on the FIXTURE Launcher Icon.",
            "- The FIXTURE launcher slot must be visible.",
            "- launcher.json lists iconUrl (FIXTURE).",
            "- Send support the FIXTURE launcher id.",
          ]),
        ),
        { coverage: { min: 0.35, minIdf: 0.5, minTerms: 1 } },
        V2,
      ),
    ).search("FIXTURE launcher icon missing in Workday", { onePerCard: true });
    expect(withoutName).toMatchObject({
      status: "ok",
      coverage: 1,
      contextIgnored: ["workday"],
    });
  });
});
