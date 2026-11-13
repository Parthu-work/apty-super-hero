/**
 * A large synthetic KB (KB-RAG K25, A3): 110 invented RAG Answer Cards in
 * 17 groups, with four layers of 600 to 750 characters each, so a pack
 * behaves like a real one of about the same size: the shared Apty words
 * (widget, workflow, segment, rule, environment, publish, balloon,
 * selector, Studio, Admin) sit in most cards and fall to a low idf, and a
 * title's own words have to carry it. Every card has a Symptom line; 10 are
 * stubs (not yet written), 6 routing pages ("Start here") and 5 "not in
 * this version" notes. Every text is invented and marked FIXTURE; none is
 * real card text.
 *
 * Built deterministically: the same list every time, no randomness.
 */

/** The product areas: each a group, with the content type its cards are about. */
const GROUPS = [
  { name: "Balloons", subject: "balloon", place: "the balloon step" },
  { name: "Workflows", subject: "workflow", place: "the workflow player" },
  { name: "Smart tips", subject: "smart tip", place: "the smart tip icon" },
  { name: "Launchers", subject: "launcher", place: "the launcher menu" },
  { name: "Surveys", subject: "survey", place: "the survey panel" },
  { name: "Checklists", subject: "checklist", place: "the checklist widget" },
  {
    name: "Announcements",
    subject: "announcement",
    place: "the announcement banner",
  },
  {
    name: "Validations",
    subject: "validation",
    place: "the validation message",
  },
  { name: "Beacons", subject: "beacon", place: "the beacon dot" },
  { name: "Segments", subject: "segment", place: "the segment list" },
  { name: "Rules", subject: "display rule", place: "the rule editor" },
  {
    name: "Environments",
    subject: "environment",
    place: "the environment picker",
  },
  { name: "Publishing", subject: "publish job", place: "the publish dialog" },
  {
    name: "Selectors",
    subject: "element selector",
    place: "the selector capture",
  },
  {
    name: "Analytics",
    subject: "analytics report",
    place: "the analytics dashboard",
  },
  {
    name: "Admin users",
    subject: "Admin user",
    place: "the user list in Admin",
  },
  {
    name: "Studio editor",
    subject: "Studio editor",
    place: "the Studio canvas",
  },
];

/**
 * What goes wrong, as a title phrase and the words an SE would use instead
 * (the Symptom line). Each card pairs one group's subject with one of them.
 */
const PROBLEMS = [
  ["does not appear after publish", "never shows up for users once we publish"],
  ["shows twice on the same page", "pops up two times in a row on one screen"],
  ["appears on the wrong page", "opens on a screen it was not meant for"],
  [
    "stays visible after the rule is turned off",
    "keeps showing even though we switched the rule off",
  ],
  ["disappears after a page reload", "is gone as soon as the user refreshes"],
  [
    "loads very slowly on single page apps",
    "takes ages to come up when the app changes route",
  ],
  [
    "shows for users outside the segment",
    "reaches people who are not in the audience",
  ],
  [
    "ignores the environment setting",
    "behaves the same in staging and production",
  ],
  [
    "breaks after the selector changes",
    "stops working since the page markup changed",
  ],
  [
    "is not translated for French users",
    "stays in English for people who use French",
  ],
  ["cannot be saved in Studio", "will not save when the author clicks save"],
  ["is missing from the analytics report", "has no numbers in the dashboard"],
  [
    "opens behind a modal dialog",
    "is hidden under the pop-up window of the app",
  ],
  ["closes before the user can read it", "vanishes too quickly to be read"],
  ["shows an empty frame", "comes up blank with nothing inside"],
  [
    "does not start from the launcher",
    "will not run when picked in the launcher",
  ],
  ["repeats at every login", "comes back each time the user signs in"],
];

/** Titles made only of the words most cards share, with their Symptom lines. */
const PLAIN = [
  [
    "Workflow content is not visible to users",
    "users cannot see the workflow content at all",
    1,
  ],
  [
    "Widget does not show for the segment",
    "the people in the segment get no widget",
    9,
  ],
  [
    "Content shows in the wrong environment",
    "content meant for staging is live in production",
    11,
  ],
  [
    "Users see content after the segment is removed",
    "people still get the content once the segment is deleted",
    9,
  ],
];

/** A setting word for a plain card, chosen from its title so it is stable. */
function settingIndexOf(title) {
  return [...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 27;
}

/** Invented setting names, one per card, so each card holds a setting of its own. */
const SETTING_WORDS = [
  "Quill",
  "Tessa",
  "Orbit",
  "Pylon",
  "Marlin",
  "Cobalt",
  "Fennel",
  "Garnet",
  "Harbor",
  "Ivory",
  "Juniper",
  "Kestrel",
  "Lumen",
  "Mosaic",
  "Nimbus",
  "Opal",
  "Prism",
  "Quartz",
  "Raven",
  "Sable",
  "Tundra",
  "Umber",
  "Vesper",
  "Willow",
  "Xenon",
  "Yarrow",
  "Zephyr",
];
const SETTING_KINDS = ["Mode", "Gate", "Window", "Guard", "Delay", "Scope"];

const SHARED_LAYER_TEXT = [
  "In Studio, open the widget, select the workflow and check each display rule against the segment and the environment before you publish again, so the content is visible to the users it is meant for.",
  "Open the Console on the customer page, run the Apty widget check, and compare the element selector with the element in the Elements panel; content that is not visible to users often has no element.",
  "In the Network tab, filter on the Apty content files and read the JSON entries for the workflow, the segment ids and the environment name, which decide whether the content is visible.",
  "Send support the Apty version, the environment name, the workflow id, the segment ids, the users affected, the browser and a HAR file of the page load.",
];

const PADDING = [
  "Most cases come from a stale publish, so publish the content again and clear the browser cache before testing.",
  "Test with a user who belongs to the segment, in a fresh browser profile, so no stored state hides the result.",
  "If the widget loads late, wait for the page to settle before you judge the result.",
  "Keep the Admin audit log open while you test; it shows who changed a rule and when.",
  "FIXTURE text: invented for the K25 large synthetic pack, never real card content.",
];

/** `text` lengthened with the padding sentences to 600 to 750 characters. */
function padded(text, seed) {
  let out = text;
  let i = seed;
  while (out.length < 620) {
    out += ` ${PADDING[i % PADDING.length]}`;
    i++;
  }
  return out.length > 750 ? `${out.slice(0, 745).trimEnd()}.` : out;
}

const HEADINGS = [
  "Studio and Admin settings",
  "Console and Elements checks",
  "Network data to read",
  "When to contact support",
];

function wrap(id, title, group, body) {
  return {
    id,
    title: `RAG Card: ${title}`,
    group: `FIXTURE ${group}`,
    updatedAt: "2026-11-01T00:00:00.000Z",
    body,
  };
}

function intro(symptom) {
  return `<p>Symptom: ${symptom}</p><p>Verified on: FIXTURE code, 2026-11-01.</p>`;
}

function fullCard(id, title, symptom, group, subject, problem, setting, n) {
  const own = [
    `The ${setting} setting on the ${subject} decides this: when the ${subject} ${problem}, turn the ${setting} setting on in Studio and publish.`,
    `In the Elements panel, find ${group.place} and check that the ${subject} element carries the ${setting} attribute; a ${subject} that ${problem} usually lacks it.`,
    `The ${subject} entry in the content JSON lists ${setting.replace(/\s+/g, "")}Id; when the ${subject} ${problem}, that id is missing or empty.`,
    `Support needs the ${subject} id and the value of the ${setting} setting when the ${subject} ${problem}.`,
  ];
  const layers = own.map((text, i) =>
    padded(`${text} ${SHARED_LAYER_TEXT[i]}`, n + i),
  );
  const body = `${intro(symptom)}${layers
    .map(
      (text, i) =>
        `<h2>Layer ${i + 1}: ${title}, ${HEADINGS[i]}</h2><ol><li><p>${text}</p></li></ol>`,
    )
    .join("")}`;
  return wrap(id, title, group.name, body);
}

function build() {
  const pages = [];
  let n = 0;
  const nextId = () => String(7001 + n++);
  // 89 full cards: four plain titles made only of words most cards share,
  // as real KBs have, then each group's subject with problems in turn.
  const full = PLAIN.map(([title, words, groupIndex]) => ({
    group: GROUPS[groupIndex],
    problem: title.toLowerCase(),
    words,
    title,
    setting: `${SETTING_WORDS[settingIndexOf(title)]} Window`,
  }));
  for (let i = 0; full.length < 89; i++) {
    const group = GROUPS[i % GROUPS.length];
    const [problem, words] =
      PROBLEMS[(i + Math.floor(i / GROUPS.length) * 5) % PROBLEMS.length];
    const title = `${group.subject[0].toUpperCase()}${group.subject.slice(1)} ${problem}`;
    if (full.some((card) => card.title === title)) continue;
    const setting = `${SETTING_WORDS[full.length % SETTING_WORDS.length]} ${
      SETTING_KINDS[
        Math.floor(full.length / SETTING_WORDS.length) % SETTING_KINDS.length
      ]
    }`;
    full.push({ group, problem, words, title, setting });
  }
  for (const [i, card] of full.entries()) {
    pages.push(
      fullCard(
        nextId(),
        card.title,
        `the ${card.group.subject} ${card.words}`,
        card.group,
        card.group.subject,
        card.problem,
        card.setting,
        i,
      ),
    );
  }
  // 10 stubs: a title and a Symptom line, the text not yet written.
  for (let i = 0; i < 10; i++) {
    const group = GROUPS[(i * 3 + 1) % GROUPS.length];
    const [problem, words] = PROBLEMS[(i * 7 + 3) % PROBLEMS.length];
    const title = `${group.subject[0].toUpperCase()}${group.subject.slice(1)} ${problem} in the mobile app`;
    pages.push(
      wrap(
        nextId(),
        title,
        group.name,
        `${intro(`the ${group.subject} ${words} on phones`)}<p>The 4.x version not yet written (FIXTURE).</p>`,
      ),
    );
  }
  // 6 routing pages.
  for (let i = 0; i < 6; i++) {
    const group = GROUPS[i * 2];
    pages.push(
      wrap(
        nextId(),
        `Start here: ${group.name} problems`,
        group.name,
        `${intro(`any problem with the ${group.subject}`)}<p>FIXTURE: read the ${group.name} cards below.</p>`,
      ),
    );
  }
  // 5 "not in this version" notes: no layers, the reason before any heading.
  const ABSENT = [
    [
      "Drop-off funnel for workflows",
      "the funnel chart showing where users leave a workflow",
      "the funnel chart arrived with the 5.x analytics",
    ],
    [
      "Survey branching by answer",
      "the survey jumping to another question from an answer",
      "branching needs the 5.x survey engine",
    ],
    [
      "Checklist sharing between tenants",
      "copying a checklist to another tenant",
      "tenant sharing is a 5.x Admin feature",
    ],
    [
      "Beacon pulse colour per segment",
      "a different beacon colour for each segment",
      "per-segment styling came with 5.x themes",
    ],
    [
      "Announcement scheduling by time zone",
      "showing an announcement at local time",
      "time zone scheduling is only in 5.x",
    ],
  ];
  for (const [i, [title, symptom, reason]] of ABSENT.entries()) {
    pages.push(
      wrap(
        nextId(),
        title,
        GROUPS[(i * 4 + 2) % GROUPS.length].name,
        `${intro(symptom)}<p>No 4.x equivalent: ${reason} (FIXTURE). There is no setting for it in 4.x.</p><p>This page is not an answer card.</p>`,
      ),
    );
  }
  return pages;
}

/** The 110 pages, ids 7001 to 7110: 89 full, 10 stubs, 6 routing, 5 absent. */
export const LARGE_SYNTHETIC_PAGES = build();
export const LARGE_SYNTHETIC_VERSION = "4.x";
