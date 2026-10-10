import type { DomHealthSnapshot } from "@apty/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockGetAllFrames = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  tabs: { sendMessage: mockSendMessage },
  webNavigation: { getAllFrames: mockGetAllFrames },
  runtime: {
    lastError: undefined,
    getManifest: () => ({ content_scripts: [] }),
  },
};

import { captureApplicationState, toFrameInventory } from "./frame-audit";

const TAB_ID = 9;
const GUID_A = "11111111-2222-4333-8444-555555555555";
const GUID_B = "99999999-8888-4777-8666-555555555555";

function lnSrc(tenant: string, session: string) {
  return `https://eln.example.test/webui/servlet/fslogin?LogicalId=lid://infor.ln.ln01&inforTenantId=${tenant}&inforSessionId=${tenant}~${session}`;
}

function counts(inputs: number, total = 50, interactive = inputs + 5) {
  return {
    totalElements: total,
    interactiveElements: interactive,
    buttons: 5,
    inputs,
    selects: 0,
    textareas: 0,
    links: 0,
    forms: inputs > 0 ? 1 : 0,
    contentEditable: 0,
  };
}

function bundle(snapshotCounts: ReturnType<typeof counts>) {
  return {
    snapshot: { counts: snapshotCounts } as unknown as DomHealthSnapshot,
    stateSignature: {
      url: "",
      navTrail: [],
      primaryHeading: null,
      structureHash: "",
    },
  };
}

type Frames = Array<{ frameId: number; parentFrameId: number; url: string }>;
type Answers = Record<
  number,
  {
    owners?: unknown[];
    counts?: ReturnType<typeof counts>;
    self?: { windowName: string | null; owner: unknown };
  }
>;

function serve(frames: () => Frames, answers: () => Answers) {
  mockGetAllFrames.mockImplementation(async () =>
    frames().map((f) => ({ ...f, errorOccurred: false })),
  );
  mockSendMessage.mockImplementation(
    (
      _tab: number,
      msg: { request: string },
      options: { frameId: number },
      callback: any,
    ) => {
      const answer = answers()[options.frameId] ?? {};
      if (msg.request === "collect-dom-health-frame-owners") {
        callback({ success: true, data: answer.owners ?? [] });
        return;
      }
      if (msg.request === "describe-dom-health-frame-self") {
        callback({
          success: true,
          data: answer.self ?? { windowName: null, owner: null },
        });
        return;
      }
      callback({ success: true, data: bundle(answer.counts ?? counts(0)) });
    },
  );
}

function owner(overrides: Record<string, unknown>) {
  return {
    tagName: "iframe",
    name: null,
    id: null,
    title: null,
    ospId: null,
    srcAttribute: null,
    className: null,
    rendered: true,
    frameId: null,
    ...overrides,
  };
}

async function capture() {
  const promise = captureApplicationState(TAB_ID, { sequenceIndex: 0 });
  await vi.runAllTimersAsync();
  const outcome = await promise;
  if (!outcome.available) throw new Error(outcome.error);
  return outcome.result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("frame identity during capture", () => {
  function servePortal(appFrameId: number, guid: string, tenant: string) {
    serve(
      () => [
        { frameId: 0, parentFrameId: -1, url: "https://portal.example.test/" },
        { frameId: appFrameId, parentFrameId: 0, url: lnSrc(tenant, guid) },
      ],
      () => ({
        0: {
          counts: counts(0),
          owners: [
            owner({
              frameId: appFrameId,
              title: "LN",
              name: `LN_44_${guid}`,
              ospId: "LN",
              srcAttribute: lnSrc(tenant, guid),
            }),
          ],
        },
        [appFrameId]: { counts: counts(6) },
      }),
    );
  }

  it("keys the LN app frame by data-osp-id under two GUID names, two tenants and two frameIds", async () => {
    servePortal(7, GUID_A, "FAKETENANT000000_TRN");
    const first = toFrameInventory((await capture()).frames);
    servePortal(12, GUID_B, "OTHERTENANT00000_PRD");
    const second = toFrameInventory((await capture()).frames);

    const app = (inventory: typeof first) =>
      inventory.find((f) => f.frameId !== 0)!;
    expect(app(first)).toMatchObject({
      key: "LN",
      keySource: "osp-id",
      keyStable: true,
      role: "application",
    });
    expect(app(second).key).toBe("LN");
    expect(app(first).urlTemplate).toBe(app(second).urlTemplate);
    expect(app(first).urlTemplate).not.toContain("TENANT");
  });

  it("classifies the portal's top document as a shell, not the application (D-7)", async () => {
    servePortal(7, GUID_A, "FAKETENANT000000_TRN");

    const top = toFrameInventory((await capture()).frames).find(
      (f) => f.frameId === 0,
    )!;

    expect(top.role).toBe("chrome");
    expect(top.roleReason).toContain('"LN"');
  });

  it("keys and classifies athenaOne's frameset: GlobalNav, GlobalWrapper, Status and the shims", async () => {
    serve(
      () => [
        {
          frameId: 0,
          parentFrameId: -1,
          url: "https://ehr.example.test/4242424/2/globalframeset.esp",
        },
        {
          frameId: 1,
          parentFrameId: 0,
          url: "https://ehr.example.test/4242424/2/globalnav.esp",
        },
        {
          frameId: 2,
          parentFrameId: 0,
          url: "https://ehr.example.test/4242424/2/globaliframe.esp",
        },
        {
          frameId: 3,
          parentFrameId: 0,
          url: "https://ehr.example.test/4242424/2/statusbar.esp",
        },
        { frameId: 4, parentFrameId: 0, url: "about:blank" },
        { frameId: 5, parentFrameId: 0, url: "javascript:document.open()" },
      ],
      () => ({
        0: {
          counts: counts(0),
          owners: [
            owner({ frameId: 1, id: "GlobalNav", className: "horizontal" }),
            owner({ frameId: 2, id: "GlobalWrapper" }),
            owner({ frameId: 3, id: "Status", className: "horizontal" }),
            owner({
              frameId: 4,
              id: "searchmenuiframe",
              className: "shimiframe",
              rendered: false,
            }),
            owner({ frameId: 5, id: "stub" }),
          ],
        },
        2: { counts: counts(12) },
        4: { counts: counts(0, 0, 0) },
      }),
    );

    const inventory = toFrameInventory((await capture()).frames);
    const byKey = new Map(inventory.map((f) => [f.key, f]));

    expect(byKey.get("GlobalNav")?.role).toBe("chrome");
    expect(byKey.get("Status")?.role).toBe("chrome");
    expect(byKey.get("GlobalWrapper")?.role).toBe("application");
    expect(byKey.get("searchmenuiframe")?.role).toBe("shim");
    expect(byKey.get("stub")?.role).toBe("shim");
    expect(byKey.get("top")?.role).toBe("chrome");
    expect(byKey.get("GlobalWrapper")?.urlTemplate).toBe(
      "https://ehr.example.test/:id/:id/globaliframe.esp",
    );
  });

  it("looks again at a rendered about:blank frame instead of recording a script-navigated frame as empty", async () => {
    let navigated = false;
    serve(
      () => [
        {
          frameId: 0,
          parentFrameId: -1,
          url: "https://ehr.example.test/4242424/2/globalframeset.esp",
        },
        {
          frameId: 1,
          parentFrameId: 0,
          url: navigated
            ? "https://ehr.example.test/4242424/2/globalnav.esp"
            : "about:blank",
        },
      ],
      () => ({
        0: {
          counts: counts(0),
          owners: [owner({ frameId: 1, id: "GlobalNav" })],
        },
        1: { counts: navigated ? counts(0, 80, 20) : counts(0, 0, 0) },
      }),
    );
    setTimeout(() => {
      navigated = true;
    }, 100);

    const result = await capture();
    const nav = result.frames.find((f) => f.frame.frameId === 1)!;

    expect(result.placeholdersRechecked).toBe(1);
    expect(nav.status).toBe("captured");
    expect(nav.identity.role.role).toBe("chrome");
    expect(nav.frame.url).toContain("globalnav.esp");
  });

  it("reports a frame that stays empty as a placeholder, never as an empty application", async () => {
    serve(
      () => [
        { frameId: 0, parentFrameId: -1, url: "https://app.example.test/" },
        { frameId: 1, parentFrameId: 0, url: "about:blank" },
      ],
      () => ({
        0: { counts: counts(2), owners: [owner({ frameId: 1, id: "later" })] },
        1: { counts: counts(0, 0, 0) },
      }),
    );

    const inventory = toFrameInventory((await capture()).frames);

    expect(inventory.find((f) => f.frameId === 1)).toMatchObject({
      role: "placeholder",
      status: "skipped-about-blank",
      key: "later",
    });
  });
});

describe("joining frames to their elements without chrome.runtime.getFrameId", () => {
  const PORTAL = "https://portal.example.test/";

  it("joins a cross-origin frame by its window.name (Infor's LN_44_<GUID>)", async () => {
    const name = `LN_44_${GUID_A}`;
    const src = lnSrc("FAKETENANT000000_TRN", GUID_A);
    serve(
      () => [
        { frameId: 0, parentFrameId: -1, url: PORTAL },
        { frameId: 3, parentFrameId: 0, url: "https://other.example.test/x" },
        { frameId: 4, parentFrameId: 0, url: src },
      ],
      () => ({
        0: {
          owners: [
            owner({
              name: "helper",
              resolvedSrc: "https://other.example.test/x",
            }),
            owner({ title: "LN", ospId: "LN", name, resolvedSrc: src }),
          ],
        },
        4: { counts: counts(4), self: { windowName: name, owner: null } },
      }),
    );

    const inventory = toFrameInventory((await capture()).frames);

    expect(inventory.find((f) => f.frameId === 4)).toMatchObject({
      key: "LN",
      keySource: "osp-id",
    });
    expect(inventory.find((f) => f.frameId === 3)).toMatchObject({
      key: "helper",
      keySource: "name",
    });
  });

  it("takes a same-origin frame's owner from its own frameElement", async () => {
    serve(
      () => [
        { frameId: 0, parentFrameId: -1, url: PORTAL },
        { frameId: 5, parentFrameId: 0, url: `${PORTAL}nav.html` },
      ],
      () => ({
        0: { owners: [owner({ id: "GlobalNav" })] },
        5: {
          self: {
            windowName: null,
            owner: owner({ id: "GlobalNav", frameId: undefined }),
          },
        },
      }),
    );

    const [, nav] = toFrameInventory((await capture()).frames);

    expect(nav).toMatchObject({ key: "GlobalNav", role: "chrome" });
  });

  it("pairs the remaining frames with the remaining elements in document order only when the counts agree", async () => {
    serve(
      () => [
        { frameId: 0, parentFrameId: -1, url: PORTAL },
        { frameId: 7, parentFrameId: 0, url: `${PORTAL}a` },
        { frameId: 8, parentFrameId: 0, url: `${PORTAL}b` },
      ],
      () => ({
        0: { owners: [owner({ id: "first" }), owner({ id: "second" })] },
      }),
    );

    const inventory = toFrameInventory((await capture()).frames);

    expect(inventory.map((f) => f.key)).toEqual(["top", "first", "second"]);
  });
});

describe("shell documents", () => {
  it("keeps an ordinary page with its own controls and a small embed as the application", async () => {
    serve(
      () => [
        { frameId: 0, parentFrameId: -1, url: "https://shop.example.test/p1" },
        {
          frameId: 2,
          parentFrameId: 0,
          url: "https://shop.example.test/ticker",
        },
      ],
      () => ({
        0: { counts: counts(0, 20, 3) },
        2: { counts: counts(0, 2, 0) },
      }),
    );

    const [top] = toFrameInventory((await capture()).frames);

    expect(top).toMatchObject({ key: "top", role: "application" });
  });
});
