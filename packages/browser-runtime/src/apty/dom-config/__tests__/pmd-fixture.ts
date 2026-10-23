/**
 * A synthetic capture shaped like the pMD worked example (DOM Config brief,
 * Appendix C): 19 pages, two runs each and a third for page 18; nocache,
 * visitDate and autocomplete timestamps changing between runs; style
 * changes; Apty-only and extension-only differences; jQuery UI ids;
 * provCheck ids; a long RptTable class run. No value comes from pMD.
 */
import type { DomProfileV2, PageCapture, RunLabel } from "../types";
import { capture, page, run, type Values, values } from "./fixtures";

const SLUGS = [
  "schedule",
  "calendar",
  "inbox",
  "billing",
  "claims",
  "reports",
  "providers",
  "settings",
  "templates",
  "tasks",
  "messages",
  "documents",
  "referrals",
  "orders",
  "labs",
  "pharmacy",
  "insurance",
  "patients",
  "audit",
];

const EXTENSION_FRAME =
  "Cross Origin 1 (src: chrome-extension://abcdefghijklmnop/login.html)";

interface RunShape {
  label: RunLabel;
  stamp: string;
  day: string;
  height: number;
  apty: boolean;
  extension: boolean;
}

function pmdProfile(
  slug: string,
  index: number,
  shape: RunShape,
): DomProfileV2 {
  const attributes: Record<string, Values> = {
    id: values(
      `${slug}-panel`,
      "home-table",
      "nav-bar",
      "main-content",
      "ui-id-1",
      "ui-id-2",
      `provCheck_100911612${index % 10}`,
    ),
    name: values(
      ["delete", 3],
      ["npi", 2],
      "firstName",
      "lastName",
      `${slug}Search`,
    ),
    "col-id": values("patientName", "visitDate", "provider", "status"),
    placeholder: values("Search", "First name", "Last name"),
    "data-ref": values(["grid", 2], "toolbar", "footer"),
    href: values(
      ["/schedule", 3],
      ["/calendar", 2],
      ["/inbox", 2],
      ["/billing", 2],
      ["/claims", 2],
      "/reports",
      "/providers",
      ["/settings", 2],
      `/${slug}?nocache=${shape.stamp}`,
      `/visits?visitDate=${shape.day}`,
    ),
    class: values(
      ["RptTable", 185],
      ["subBodytext", 14],
      ["group-item", 6],
      ["modifier-row", 4],
      "header",
      "footer",
    ),
    type: values(["text", 4], ["button", 2], "checkbox"),
    role: values(["button", 5], "dialog"),
    src: values(["/img/spacer.gif", 10], "/img/logo.png"),
    autocomplete: values(`off_${shape.stamp}`),
    "aria-expanded": values("true", "false"),
    width: values("100%"),
    tabindex: values(["0", 4], "-1"),
    style: values(
      `height: ${shape.height}px`,
      `top: ${shape.height / 4}px; left: 20px`,
    ),
  };
  const tags: Values = {
    html: 1,
    head: 1,
    body: 1,
    div: 60,
    span: 20,
    table: 3,
    tr: 190,
    td: 400,
    a: 15,
    input: 6,
    form: 1,
    img: 11,
  };
  const extra: Partial<DomProfileV2> = { maxZIndex: 9999 };
  if (shape.apty) {
    Object.assign(tags, {
      "apty-widget": 1,
      "apty-content-items": 1,
      "apty-focus-footer": 1,
    });
    attributes.class = {
      ...attributes.class,
      "apty-visibility-ignore-element": 2,
    };
    attributes["data-apty-root"] = values("true");
  }
  if (shape.extension) {
    attributes.id = { ...attributes.id, jumpcloud_autofill_dialog: 1 };
    attributes["data-myki-field"] = values(["1", 3]);
    attributes["jcpwm-id"] = values(`tok${shape.stamp.slice(-3)}x`);
    attributes.style = {
      ...attributes.style,
      "z-index: 999999; position: fixed": 1,
    };
    tags.iframe = 1;
    extra.maxZIndex = 999999;
    extra.iframes = { [EXTENSION_FRAME]: { isCrossOrigin: true } };
  }
  return { tags, attributes, ...extra };
}

function pmdPage(slug: string, index: number): PageCapture {
  const shapes: RunShape[] = [
    {
      label: "initial",
      stamp: `1729700000${String(100 + index)}`,
      day: "10/22/2026",
      height: 100,
      apty: index % 2 === 0,
      extension: index % 3 === 0,
    },
    {
      label: "after-reload",
      stamp: `1729700900${String(100 + index)}`,
      day: "10/23/2026",
      height: 104,
      apty: true,
      extension: false,
    },
  ];
  if (index === 17) {
    shapes.push({
      ...shapes[1]!,
      label: "repeat",
      stamp: "1729609000555",
      height: 104,
    });
  }
  return page(
    `p${String(index + 1).padStart(2, "0")}`,
    shapes.map((shape) =>
      run(shape.label, pmdProfile(slug, index, shape), {
        capturedAt: shape.label === "initial" ? "2026-10-22" : "2026-10-23",
        urlShape: `/${slug}`,
      }),
    ),
    slug,
  );
}

export function pmdCapture() {
  return capture(
    SLUGS.map((slug, index) => pmdPage(slug, index)),
    "pMD (synthetic)",
  );
}
