/**
 * Synthetic RAG Answer Cards for the K8 evaluation in CI: invented
 * products, settings and files, marked FIXTURE. Built into a pack at test
 * time by the K1 builder; never real card text.
 */
function page(id, title, layers) {
  return {
    id,
    title: `RAG Card: ${title}`,
    group: "FIXTURE group",
    updatedAt: "2026-02-01T00:00:00.000Z",
    body: `<p>Verified on: FIXTURE code, 2026-01-01.</p>${layers
      .map(
        (text, i) =>
          `<h2>Layer ${i + 1}: ${title}, part ${i + 1}</h2><ol><li><p>${text}</p></li></ol>`,
      )
      .join("")}`,
  };
}

export const SYNTHETIC_PAGES = [
  page("1001", "FIXTURE banner never glows", [
    "In Studio, turn on the FIXTURE Glowing Banner switch and publish.",
    "Check that the FIXTURE banner slot element exists on the page.",
    "glow.json lists glowIds for each FIXTURE banner.",
    "Send support: the FIXTURE version and the banner id.",
  ]),
  page("1002", "FIXTURE tooltip opens twice", [
    "In Studio, clear the FIXTURE Double Trigger option on the tooltip.",
    "The FIXTURE anchor element must be unique on the page.",
    "tooltip.json lists triggerCount for the FIXTURE tooltip.",
    "Send support: the FIXTURE version and the tooltip id.",
  ]),
  page("1003", "FIXTURE survey is blank", [
    "In Admin, set the FIXTURE Survey Locale for the user's language.",
    "The FIXTURE survey frame must load in the Console.",
    "NOT VERIFIED: survey.json lists questions per locale (FIXTURE).",
    "Send support: the FIXTURE version and the survey id.",
  ]),
  page("1004", "FIXTURE launcher icon is missing", [
    "In Studio, assign the FIXTURE Launcher Icon before publishing.",
    "The FIXTURE launcher container must not be hidden by page CSS.",
    "launcher.json lists iconUrl for the FIXTURE launcher.",
    "Send support: the FIXTURE version and the launcher id.",
  ]),
  page("1005", "FIXTURE checklist progress resets", [
    "In Admin, turn on FIXTURE Remember Progress for the checklist.",
    "Local storage must keep the FIXTURE progress key.",
    "progress.json lists completedSteps for the FIXTURE user.",
    "Send support: the FIXTURE version and the checklist id.",
  ]),
];
