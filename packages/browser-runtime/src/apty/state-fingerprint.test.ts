import type { FrameStateSignature } from "@apty/dom-snapshot";
import { describe, expect, it } from "vitest";
import type { FrameSignatureEntry } from "./route-key.js";
import {
  compareStateFingerprints,
  computeStateFingerprint,
} from "./state-fingerprint.js";

/** The LN application frame's `src`, shaped as measured in the Infor LN export (tenant and session values are fakes of the same shape). */
const lnSrc = (tenant: string, session: string) =>
  `https://eln.example.test/webui/servlet/fslogin?commonui=true&LogicalId=lid://infor.ln.ln01&inforThemeName=Light&inforCurrentLocale=en-GB&inforTenantId=${tenant}&inforSessionId=${tenant}~${session}`;

function signature(
  overrides: Partial<FrameStateSignature> = {},
): FrameStateSignature {
  return {
    url: "https://app.example.test/",
    navTrail: [],
    primaryHeading: null,
    structureHash: "s1",
    ...overrides,
  };
}

function entry(
  overrides: Partial<FrameSignatureEntry> &
    Pick<FrameSignatureEntry, "frameId" | "frameKey">,
): FrameSignatureEntry {
  return {
    frameKeyStable: true,
    frameRole: "application",
    depth: overrides.frameId === 0 ? 0 : 1,
    urlTemplate: "",
    signature: signature(),
    ...overrides,
  };
}

/** Infor OS Portal: the selected portal tab lives in the top document (a shell), the screen in the LN frame. */
function lnState(params: {
  lnFrameId: number;
  tenant: string;
  session: string;
  heading: string;
  trail?: string[];
}): FrameSignatureEntry[] {
  return [
    entry({
      frameId: 0,
      frameKey: "top",
      frameRole: "chrome",
      signature: signature({
        url: "https://portal.example.test/",
        navTrail: ["LN"],
      }),
    }),
    entry({
      frameId: params.lnFrameId,
      frameKey: "LN",
      signature: signature({
        url: lnSrc(params.tenant, params.session),
        navTrail: params.trail ?? [],
        primaryHeading: params.heading,
      }),
    }),
  ];
}

/** athenaOne: the practice id and department are URL path segments of every frame. */
function athenaState(params: {
  practice: string;
  department: string;
  frameIds: [number, number];
  heading: string;
}): FrameSignatureEntry[] {
  const base = `https://ehr.example.test/${params.practice}/${params.department}`;
  return [
    entry({
      frameId: params.frameIds[0],
      frameKey: "GlobalNav",
      frameRole: "chrome",
      signature: signature({
        url: `${base}/globalnav.esp`,
        navTrail: ["Patients"],
      }),
    }),
    entry({
      frameId: params.frameIds[1],
      frameKey: "GlobalWrapper",
      signature: signature({
        url: `${base}/ax/registration`,
        primaryHeading: params.heading,
      }),
    }),
  ];
}

function compare(a: FrameSignatureEntry[], b: FrameSignatureEntry[]) {
  return compareStateFingerprints(
    computeStateFingerprint(a),
    computeStateFingerprint(b),
  );
}

describe("state fingerprint and RouteKey (WP-5, D-3)", () => {
  it("compares the same LN screen as same across tenants, sessions and frameIds", () => {
    const result = compare(
      lnState({
        lnFrameId: 3,
        tenant: "FAKETENANT000000_TRN",
        session: "00000000-0000-4000-8000-000000000000",
        heading: "Sales Orders",
      }),
      lnState({
        lnFrameId: 17,
        tenant: "FAKETENANT111111_TRN",
        session: "11111111-1111-4111-8111-111111111111",
        heading: "Sales Orders",
      }),
    );

    expect(result.result).toBe("same");
    expect(result.confidence).toBe("high");
  });

  it("compares the same athenaOne screen as same across practices, departments and frameIds", () => {
    const result = compare(
      athenaState({
        practice: "4242424",
        department: "2",
        frameIds: [4, 5],
        heading: "Contact Details",
      }),
      athenaState({
        practice: "1234567",
        department: "31",
        frameIds: [9, 12],
        heading: "Contact Details",
      }),
    );

    expect(result.result).toBe("same");
  });

  it("compares a navigation that changes only the nav trail and heading as different, without quoting either", () => {
    const before = lnState({
      lnFrameId: 3,
      tenant: "FAKETENANT000000_TRN",
      session: "00000000-0000-4000-8000-000000000000",
      heading: "Sales Orders",
      trail: ["Sales"],
    });
    const after = lnState({
      lnFrameId: 3,
      tenant: "FAKETENANT000000_TRN",
      session: "00000000-0000-4000-8000-000000000000",
      heading: "Purchase Orders",
      trail: ["Purchasing"],
    });

    const result = compare(before, after);

    expect(result.result).toBe("different");
    expect(result.reasons).toEqual([
      "the navigation trail changed",
      "the primary heading changed",
    ]);
    expect(result.reasons.join(" ")).not.toMatch(/Purchas|Sales/);
  });

  it("treats a heading that differs only by a record number as the same screen", () => {
    const a = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ primaryHeading: "Order 47110" }),
      }),
    ];
    const b = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ primaryHeading: "Order 47111" }),
      }),
    ];

    expect(compare(a, b).result).toBe("same");
  });

  it("ignores a structure change when a heading names the screen (an expanded panel is not a new state)", () => {
    const a = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ primaryHeading: "Orders", structureHash: "s1" }),
      }),
    ];
    const b = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ primaryHeading: "Orders", structureHash: "s2" }),
      }),
    ];

    expect(compare(a, b).result).toBe("same");
  });

  it("reports a structure-only key as low confidence, and a change it detects as low confidence", () => {
    const a = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ structureHash: "s1" }),
      }),
    ];
    const b = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ structureHash: "s2" }),
      }),
    ];

    const fingerprint = computeStateFingerprint(a);
    expect(fingerprint.routeKey.confidence).toBe("low");
    expect(fingerprint.routeKey.contributingSignals).toEqual([
      "frame",
      "urlTemplate",
      "structure",
    ]);

    const result = compare(a, b);
    expect(result.result).toBe("different");
    expect(result.confidence).toBe("low");
    expect(result.reasons[0]).toContain("low confidence");
  });

  it("is uncertain when an application frame could be read at one point and not the other", () => {
    const readable = lnState({
      lnFrameId: 3,
      tenant: "FAKETENANT000000_TRN",
      session: "00000000-0000-4000-8000-000000000000",
      heading: "Sales Orders",
    });
    const unreadable = readable.map((e) =>
      e.frameKey === "LN" ? { ...e, signature: null } : e,
    );

    const result = compare(readable, unreadable);

    expect(result.result).toBe("uncertain");
    expect(result.reasons).toContain(
      'frame "LN" could not be inspected at one of the two points compared',
    );
  });

  it("never lets a shim or overlay frame's content change the state", () => {
    const base = [
      entry({
        frameId: 0,
        frameKey: "top",
        signature: signature({ primaryHeading: "Orders" }),
      }),
    ];
    const withOverlay = [
      ...base,
      entry({
        frameId: 8,
        frameKey: "pendo-guide",
        frameRole: "overlay",
        signature: signature({
          primaryHeading: "Welcome!",
          navTrail: ["Step 1"],
        }),
      }),
      entry({
        frameId: 9,
        frameKey: "searchmenuiframe",
        frameRole: "shim",
        signature: null,
      }),
    ];

    expect(compare(base, withOverlay).result).toBe("same");
  });

  it("rates a named screen in a positionally keyed frame as medium confidence", () => {
    const key = computeStateFingerprint([
      entry({
        frameId: 2,
        frameKey: "position:0/1",
        frameKeyStable: false,
        signature: signature({ primaryHeading: "Orders" }),
      }),
    ]).routeKey;

    expect(key.confidence).toBe("medium");
    expect(key.contributingSignals).not.toContain("frame");
  });
});
