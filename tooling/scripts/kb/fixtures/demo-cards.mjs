/**
 * Synthetic RAG Answer Cards for the demo packs (KB-RAG K20) and the
 * synthetic edge-case set (FIXES.md section 7.2): invented products,
 * settings and files, every card marked DEMO and FIXTURE. Never real card
 * text. Each version has full cards, one stub (its text not yet written),
 * one routing card ("Start here") and one title shared with the other
 * version.
 */
function page(id, title, symptom, layers, { status = "full", version } = {}) {
  const intro = `<p>Symptom: ${symptom}</p><p>Verified on: FIXTURE demo, 2026-11-01.</p>`;
  if (status === "stub") {
    return card(
      id,
      title,
      `${intro}<p>The ${version} version not yet written (FIXTURE).</p>`,
    );
  }
  if (status === "routing") {
    return card(
      id,
      title,
      `${intro}<p>FIXTURE: read the DEMO cards below.</p>`,
    );
  }
  const headings = [
    "Studio and Admin settings",
    "Console and Elements checks",
    "Network data to read",
    "When to contact support",
  ];
  return card(
    id,
    title,
    `${intro}${layers
      .map(
        (text, i) =>
          `<h2>Layer ${i + 1}: ${title}, ${headings[i]}</h2><ol><li><p>${text} (FIXTURE)</p></li></ol>`,
      )
      .join("")}`,
  );
}

function card(id, title, body) {
  return {
    id,
    title: `RAG Card: ${title}`,
    group: "DEMO group",
    updatedAt: "2026-11-01T00:00:00.000Z",
    body,
  };
}

const SUPPORT = (what) =>
  `Send support the DEMO version, the ${what} and a screenshot of the page.`;

export const DEMO_PAGES_5X = [
  page(
    "2001",
    "DEMO tooltip flickers on hover",
    "The DEMO help bubble keeps blinking while the pointer rests on the field.",
    [
      "In Studio, turn off the DEMO Hover Pulse option on the tooltip and publish.",
      "In the Console, two hover listeners on the anchor element cause the blinking.",
      "pulse.json lists pulseRate for each DEMO tooltip.",
      SUPPORT("tooltip id"),
    ],
  ),
  page(
    "2002",
    "DEMO tour stops after a page reload",
    "After the user presses F5 the DEMO tour does not continue where it was.",
    [
      "In Studio, turn on the DEMO Resume Tour option and publish.",
      "In Elements, session storage must keep the DEMO tour key after the reload.",
      "resume.json lists resumeStep for the DEMO tour.",
      SUPPORT("tour id"),
    ],
  ),
  page(
    "2003",
    "DEMO one user cannot see the panel",
    "A single person is missing the DEMO panel while their colleagues have it.",
    [
      "In Admin, add the person to the DEMO panel's user group and publish.",
      "In Elements, the DEMO panel container is hidden for that person only.",
      "panel.json lists groupIds for the DEMO panel.",
      SUPPORT("user id"),
    ],
  ),
  page(
    "2004",
    "DEMO panel shows for every user",
    "Everyone sees the DEMO panel although it is limited to one group.",
    [
      "In Admin, turn off the DEMO Show To All option on the panel.",
      "In the Console, the DEMO panel renders before the group check finishes.",
      "groups.json lists allowAll for the DEMO panel.",
      SUPPORT("group id"),
    ],
  ),
  page(
    "2005",
    "DEMO widget is slow to open",
    "The DEMO widget takes many seconds to appear and the page lags meanwhile.",
    [
      "In Admin, lower the DEMO Preload Size and publish.",
      "In DevTools Performance, the DEMO widget script blocks the main thread.",
      "bundle.json lists preloadSize in kilobytes.",
      SUPPORT("recording of the slowness"),
    ],
  ),
  page(
    "2006",
    "DEMO survey shows untranslated",
    "Users who chose German or French still get the DEMO survey in its default text.",
    [
      "In Studio, add a translation for each locale of the DEMO survey and publish.",
      "In the Console, the DEMO survey reads the user's locale from the page.",
      "survey.json lists questions per locale for the DEMO survey.",
      SUPPORT("survey id and the user's locale"),
    ],
  ),
  page(
    "2007",
    "DEMO launcher icon missing after publish",
    "The DEMO launcher button vanished once the content went live.",
    [
      "In Studio, assign the DEMO Launcher Icon before publishing.",
      "In Elements, page CSS hides the DEMO launcher container.",
      "launcher.json lists iconUrl for the DEMO launcher.",
      SUPPORT("launcher id"),
    ],
  ),
  page(
    "2008",
    "DEMO segments.json response, what it means",
    "The Network tab lists segments.json and the user wants to read its answer.",
    [
      "In Admin, every DEMO segment must be active to appear in segments.json.",
      "In the Console, the DEMO player logs the segments it loaded.",
      "segments.json returns the DEMO segments; a 403 status means the token expired; an empty list [] means no segment is published.",
      SUPPORT("segments.json response and its status"),
    ],
  ),
  page(
    "2009",
    "DEMO workflow-ID.json response, what it means",
    "The Network tab lists workflow-<id>.json and the user wants to read its answer.",
    [
      "In Studio, publish the DEMO workflow before reading workflow-ID.json.",
      "In the Console, the DEMO player logs the workflow id it requested.",
      "workflow-ID.json holds the DEMO steps; a 404 status means the workflow is not published.",
      SUPPORT("workflow-ID.json response and its status"),
    ],
  ),
  page(
    "2010",
    "DEMO checklist repeats at each login",
    "The DEMO checklist keeps coming back every time the user signs in.",
    [
      "In Admin, turn on DEMO Remember Completion for the checklist.",
      "In Elements, local storage must keep the DEMO completion key.",
      "progress.json lists completedSteps for the DEMO user.",
      SUPPORT("checklist id"),
    ],
  ),
  page(
    "2011",
    "DEMO validation rejects a valid email",
    "The DEMO field check refuses an address that is correct.",
    [
      "In Studio, edit the DEMO Email Pattern of the validation and publish.",
      "In the Console, test the DEMO email pattern against the address.",
      "validation.json lists the pattern for each DEMO validation.",
      SUPPORT("validation id"),
    ],
  ),
  page(
    "2012",
    "DEMO beacon hides behind the menu",
    "The DEMO beacon sits under the navigation menu where nobody can click it.",
    [
      "In Studio, raise the DEMO Beacon Layer above the menu and publish.",
      "In Elements, the menu's z-index covers the DEMO beacon.",
      "beacon.json lists layerIndex for each DEMO beacon.",
      SUPPORT("beacon id"),
    ],
  ),
  page(
    "2013",
    "DEMO bulk export of guides times out",
    "Exporting many DEMO guides at once never finishes.",
    [],
    { status: "stub", version: "5.x" },
  ),
  page(
    "2014",
    "Start here: DEMO panel and tooltip questions",
    "Which DEMO panel or tooltip card to read first.",
    [],
    { status: "routing" },
  ),
];

export const DEMO_PAGES_4X = [
  page(
    "4001",
    "DEMO flow skips the second step",
    "The DEMO flow jumps straight from step one to step three.",
    [
      "In 4.x Studio, clear the DEMO Auto Advance option on step two and publish.",
      "In Elements, the element of step two is not on the page when the flow reaches it.",
      "flow-ID.json lists advanceMode for each DEMO step.",
      SUPPORT("flow id"),
    ],
  ),
  page(
    "4002",
    "DEMO balloon does not appear on the field",
    "No balloon appears when the user clicks into the DEMO field.",
    [
      "In 4.x Studio, set the DEMO Balloon Trigger to focus and publish.",
      "In the Console, the selector of the DEMO balloon matches nothing on the page.",
      "flow.json lists triggerType for each DEMO balloon.",
      SUPPORT("balloon id"),
    ],
  ),
  page(
    "4003",
    "DEMO player freezes the page",
    "The DEMO application hangs and stops responding once the player loads.",
    [
      "In 4.x Admin, turn off the DEMO Deep Scan option and publish.",
      "In DevTools Performance, the DEMO player's observer runs on every change.",
      "feature-flag.json lists deepScan for the tenant.",
      SUPPORT("recording of the freeze"),
    ],
  ),
  page(
    "4004",
    "DEMO flow-ID.json response, what it means",
    "The Network tab lists flow-<id>.json and the user wants to read its answer.",
    [
      "In 4.x Studio, publish the DEMO flow before reading flow-ID.json.",
      "In the Console, the DEMO player logs the flow id it requested.",
      "flow-ID.json holds the DEMO steps; a 404 status means the flow is not published; an empty list [] means it has no steps.",
      SUPPORT("flow-ID.json response and its status"),
    ],
  ),
  page(
    "4005",
    "DEMO app-urls.json response, what it means",
    "The Network tab lists app-urls.json and the user wants to read its answer.",
    [
      "In 4.x Admin, every DEMO environment needs a URL pattern for its pages.",
      "In the Console, the DEMO player logs the environment it picked.",
      "app-urls.json returns the DEMO applications; a 500 status is read as an empty list; an empty list [] means no application is published.",
      SUPPORT("app-urls.json response and its status"),
    ],
  ),
  page(
    "4006",
    "DEMO widget works in UAT but not in production",
    "The DEMO widget appears on the staging site but never on the live one.",
    [
      "In 4.x Admin, add the production URL pattern to the DEMO Production environment.",
      "In the Console, the DEMO player reports no environment for the live page.",
      "app-urls.json lists the URL patterns of each DEMO environment.",
      SUPPORT("environment names"),
    ],
  ),
  page(
    "4007",
    "DEMO hint text is cropped",
    "The DEMO hint is cut off at the edge of the window and unreadable.",
    [
      "In 4.x Studio, set the DEMO Hint Width to automatic and publish.",
      "In Elements, the DEMO hint container has a fixed width.",
      "flow.json lists hintWidth for each DEMO hint.",
      SUPPORT("hint id"),
    ],
  ),
  page(
    "4008",
    "DEMO flow shows duplicate steps",
    "The DEMO flow displays the same step twice in a row.",
    [
      "In 4.x Studio, remove the DEMO copied step and publish.",
      "In the Console, two DEMO step ids share one element.",
      "flow-ID.json lists the step ids of the DEMO flow.",
      SUPPORT("flow id"),
    ],
  ),
  page(
    "4009",
    "DEMO segment ignores the user group",
    "Only some users of the DEMO group get the flow, others never do.",
    [
      "In 4.x Admin, base the DEMO segment rule on the user group attribute.",
      "In the Console, the DEMO player logs the attributes it read for the user.",
      "segments.json and rules.json list the DEMO segment and its rule.",
      SUPPORT("segment id"),
    ],
  ),
  page(
    "4010",
    "DEMO beacon hides behind the menu",
    "The DEMO beacon sits under the navigation menu where nobody can click it.",
    [
      "In 4.x Studio, raise the DEMO Beacon Depth above the menu and publish.",
      "In Elements, the menu's z-index covers the DEMO beacon.",
      "flow.json lists beaconDepth for each DEMO beacon.",
      SUPPORT("beacon id"),
    ],
  ),
  page(
    "4011",
    "DEMO Content-Security-Policy blocks the player",
    "The DEMO player does not load and the Console names a CSP violation.",
    [
      "In 4.x Admin, turn on the DEMO Nonce Header option and publish.",
      "In the Console, the Content-Security-Policy message names the blocked DEMO script.",
      "The DEMO player script request returns no body when it is blocked.",
      SUPPORT("Console message"),
    ],
  ),
  page(
    "4012",
    "DEMO analytics events missing in the dashboard",
    "DEMO analytics events never show in the reports.",
    [],
    { status: "stub", version: "4.x" },
  ),
  page(
    "4013",
    "Start here: DEMO flow questions",
    "Which DEMO flow card to read first.",
    [],
    { status: "routing" },
  ),
];
