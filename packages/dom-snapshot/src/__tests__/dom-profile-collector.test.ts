import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COLLECTOR_BUDGET } from "../collector-budget";
import {
  collectDomProfile,
  DOM_PROFILE_LIMITS,
} from "../dom-profile-collector";
import { runDomAnalysisScript } from "./fixtures/dom-analysis-script";

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function shared(profile: Awaited<ReturnType<typeof collectDomProfile>>) {
  const { tags, attributes, maxZIndex, shadowRoots } = profile;
  return plain({ tags, attributes, maxZIndex, shadowRoots });
}

const relaxed = process.env.DOM_SNAPSHOT_INSTRUMENTED
  ? { timeBudgetMs: 60_000 }
  : {};

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.restoreAllMocks();
});

describe("collectDomProfile", () => {
  it("writes the console script's JSON for the same page (acceptance criterion 1)", async () => {
    document.head.innerHTML = "<title>Visits</title>";
    document.body.innerHTML = `
      <div id="home-table" class="RptTable grid" data-ref="grid">
        <input name="firstName" placeholder="First name" autocomplete="off_1729">
        <a href="/visits?visitDate=10/23/2026">Visits</a>
        <span id="ui-id-1" style="position: relative; z-index: 1500">Tip</span>
        <span style="position: relative; z-index: -2">Behind</span>
        <x-card class="card"></x-card><x-empty></x-empty>
        <template><b id="inert">not rendered</b></template>
      </div>`;
    const card = document
      .querySelector("x-card")!
      .attachShadow({ mode: "open" });
    card.innerHTML =
      '<header class="title" style="position: absolute; z-index: 30">Card</header><x-badge></x-badge>';
    card.querySelector("x-badge")!.attachShadow({ mode: "open" }).innerHTML =
      '<i class="dot" aria-hidden="true"></i>';
    document.querySelector("x-empty")!.attachShadow({ mode: "open" });

    const profile = await collectDomProfile(document, relaxed);

    expect(shared(profile)).toEqual(plain(runDomAnalysisScript(document)));
    expect(profile.tags).toMatchObject({
      div: 1,
      input: 1,
      span: 2,
      template: 1,
    });
    expect(profile.tags.b).toBeUndefined();
    expect(profile.shadowRoots?.["x-card"]?.shadowRoots?.["x-badge"]).toEqual({
      tags: { i: 1 },
      attributes: { class: { dot: 1 }, "aria-hidden": { true: 1 } },
    });
    expect(profile.meta).toMatchObject({
      partial: false,
      truncatedAttributes: [],
      cutValues: 0,
      closedShadowRootsVisible: false,
      aptyPresent: false,
      extensionNoisePresent: false,
    });
  });

  it("keeps page values such as constructor or __proto__ as plain keys", async () => {
    document.body.innerHTML =
      '<div title="constructor"></div><div title="__proto__"></div><constructor></constructor>';

    const profile = plain(await collectDomProfile(document, relaxed));

    expect(profile.attributes.title).toEqual(
      JSON.parse('{"constructor":1,"__proto__":1}'),
    );
    expect(profile.tags.constructor).toBe(1);
  });

  it("names the element behind each z-index of 1000 or more", async () => {
    document.body.innerHTML = `
      <div id="toast-host" class="toast layer" style="position: fixed; z-index: 9999"></div>
      <img alt="" style="position: fixed; z-index: 999999">
      <p style="position: relative; z-index: 999">low</p>`;

    const profile = await collectDomProfile(document, relaxed);

    expect(profile.zIndexSources).toEqual([
      {
        value: 9999,
        tag: "div",
        id: "toast-host",
        class: "toast layer",
        inline: true,
      },
      { value: 999999, tag: "img", inline: true },
    ]);
    expect(profile.meta?.extensionNoisePresent).toBe(true);
  });

  it("records each frame element's real src and whether this document can read it, never entering it", async () => {
    document.body.innerHTML = `
      <iframe id="same"></iframe>
      <iframe id="cross" src="https://docs.example.test/view/1234567?sig=abc"></iframe>
      <iframe id="gone" src="/later"></iframe>
      <iframe id="srcdoc" srcdoc="<p>hi</p>"></iframe>
      <iframe id="ext" src="chrome-extension://abcdefghijklmnop/login.html"></iframe>`;
    const frame = (id: string) =>
      document.getElementById(id) as HTMLIFrameElement;
    Object.defineProperty(frame("cross"), "contentWindow", {
      get: () => ({
        get location(): Location {
          throw new DOMException(
            "Blocked a frame with origin",
            "SecurityError",
          );
        },
      }),
    });
    Object.defineProperty(frame("gone"), "contentWindow", { get: () => null });
    Object.defineProperty(frame("srcdoc"), "contentWindow", {
      get: () => ({ location: { href: "about:srcdoc" } }),
    });
    const ids = new Map([
      ["same", 3],
      ["cross", 4],
    ]);

    const profile = await collectDomProfile(document, {
      ...relaxed,
      frameIdOf: (element) => ids.get(element.id) ?? null,
    });

    expect(profile.frames).toEqual([
      {
        src: "",
        crossOrigin: false,
        readable: true,
        reason: "about:blank",
        frameId: 3,
      },
      {
        src: "https://docs.example.test/view/:id?sig",
        resolvedSrc: "https://docs.example.test/view/:id?sig",
        crossOrigin: true,
        readable: false,
        reason: "blocked-cross-origin",
        frameId: 4,
      },
      {
        src: "/later",
        resolvedSrc: "http://localhost:3000/later",
        crossOrigin: false,
        readable: false,
        reason: "not-loaded",
      },
      { src: "", crossOrigin: false, readable: true, reason: "srcdoc" },
      {
        src: "chrome-extension://abcdefghijklmnop/login.html",
        resolvedSrc: "chrome-extension://abcdefghijklmnop/login.html",
        crossOrigin: false,
        readable: false,
        reason: "noise",
      },
    ]);
    expect(profile.tags.iframe).toBe(4);
    expect(profile.tags.p).toBeUndefined();
    expect(profile.iframes).toBeUndefined();
    expect(profile.meta?.extensionNoisePresent).toBe(true);
  });

  it("reads closed shadow roots only where the extension API can, and says so", async () => {
    document.body.innerHTML = "<x-open></x-open><x-secure></x-secure>";
    document.querySelector("x-open")!.attachShadow({ mode: "open" }).innerHTML =
      "<button>open</button>";
    const host = document.querySelector("x-secure")!;
    const closed = host.attachShadow({ mode: "closed" });
    closed.innerHTML = '<button id="pay">closed</button>';

    const without = await collectDomProfile(document, relaxed);
    expect(without.shadow).toEqual([{ hostTag: "x-open", mode: "open" }]);
    expect(without.meta?.closedShadowRootsVisible).toBe(false);

    (globalThis as { chrome?: unknown }).chrome = {
      dom: {
        openOrClosedShadowRoot: (element: Element) =>
          element === host ? closed : element.shadowRoot,
      },
    };
    const withApi = await collectDomProfile(document, relaxed);
    expect(withApi.shadow).toEqual([
      { hostTag: "x-open", mode: "open" },
      { hostTag: "x-secure", mode: "closed" },
    ]);
    expect(withApi.shadowRoots?.["x-secure"]?.attributes).toEqual({
      id: { pay: 1 },
    });
    expect(withApi.meta?.closedShadowRootsVisible).toBe(true);
  });

  it("merges every shadow root of one host tag, where the script reads only the first", async () => {
    document.body.innerHTML = "<x-cell></x-cell><x-cell></x-cell>";
    const [a, b] = Array.from(document.querySelectorAll("x-cell"));
    a!.attachShadow({ mode: "open" }).innerHTML = '<span id="ui-id-1"></span>';
    b!.attachShadow({ mode: "open" }).innerHTML = '<span id="ui-id-2"></span>';

    const profile = await collectDomProfile(document, relaxed);

    expect(profile.shadowRoots?.["x-cell"]).toEqual({
      tags: { span: 2 },
      attributes: { id: { "ui-id-1": 1, "ui-id-2": 1 } },
    });
    expect(
      runDomAnalysisScript(document).shadowRoots?.["x-cell"]?.tags,
    ).toEqual({ span: 1 });
  });

  it("leaves noise subtrees out and says what it left out", async () => {
    document.body.innerHTML = `
      <main id="app"><input name="email" data-myki-field="1"></main>
      <apty-widget><div class="tip" data-step="3">Next</div></apty-widget>
      <div id="apty-agent-content-root"><button>Agent</button></div>`;

    const profile = await collectDomProfile(document, relaxed);

    expect(profile.tags).toEqual({
      html: 1,
      head: 1,
      body: 1,
      main: 1,
      input: 1,
    });
    expect(profile.attributes["data-step"]).toBeUndefined();
    expect(profile.attributes["data-myki-field"]).toEqual({ 1: 1 });
    expect(profile.meta).toMatchObject({
      aptyPresent: true,
      extensionNoisePresent: true,
    });
    expect(
      profile.meta?.excludedRoots?.map((e) => [e.matcher, e.elementCount]),
    ).toEqual([
      ["id:apty-agent-", 2],
      ["tag:apty-widget", 2],
    ]);
  });

  it("bounds values: a long one keeps its start, length and a hash; too many distinct ones are flagged", async () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      zIndex: "auto",
    } as CSSStyleDeclaration);
    const long = `${"x".repeat(DOM_PROFILE_LIMITS.maxValueLength)}TAIL-1234567`;
    const rows = Array.from(
      { length: DOM_PROFILE_LIMITS.maxDistinctValuesPerAttribute + 3 },
      (_, i) => `<i data-row="r${i}"></i>`,
    ).join("");
    document.body.innerHTML = `<p title="${long}"></p>${rows}`;

    const profile = await collectDomProfile(document, relaxed);

    const [kept] = Object.keys(profile.attributes.title!);
    expect(kept).toMatch(/^x{400}…\[412#[0-9a-f]+\]$/);
    expect(kept).not.toContain("1234567");
    expect(Object.keys(profile.attributes["data-row"]!)).toHaveLength(
      DOM_PROFILE_LIMITS.maxDistinctValuesPerAttribute,
    );
    expect(profile.meta).toMatchObject({
      cutValues: 1,
      truncatedAttributes: ["data-row"],
    });
  });

  it("labels a result partial when a ceiling or the time budget stops it", async () => {
    document.body.innerHTML = "<div><p></p><p></p><p></p><p></p></div>";

    const capped = await collectDomProfile(document, { maxTotalElements: 4 });
    expect(capped.meta).toMatchObject({
      partial: true,
      partialReasons: [
        "Element ceiling of 4 reached; elements after it were not read.",
      ],
      elementCount: 4,
    });

    const timed = await collectDomProfile(document, { timeBudgetMs: -1 });
    expect(timed.meta?.partial).toBe(true);
    expect(timed.meta?.partialReasons?.[0]).toMatch(
      /^Time budget of -1 ms reached/,
    );
  });

  it("keeps the page's URL only as a shape", async () => {
    window.history.replaceState(
      null,
      "",
      "/patients/1234567/chart?mrn=884213&tab=notes",
    );

    const profile = await collectDomProfile(document, relaxed);

    expect(profile.meta?.urlShape).toBe(
      "http://localhost:3000/patients/:id/chart?mrn&tab",
    );
    window.history.replaceState(null, "", "/");
  });

  it("profiles 10,000 elements within the budget (jsdom's style engine stubbed; real-browser timing is in dom-config-collector.e2e)", async () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      zIndex: "auto",
    } as CSSStyleDeclaration);
    document.body.innerHTML = Array.from(
      { length: 2_500 },
      (_, i) =>
        `<div class="row" data-row="${i}"><span class="cell">a</span><input name="f${i % 40}"><b></b></div>`,
    ).join("");

    const profile = await collectDomProfile(document, relaxed);

    expect(profile.meta?.elementCount).toBe(10_003);
    expect(profile.meta?.partial).toBe(false);
    expect(profile.meta?.durationMs).toBeLessThan(
      relaxed.timeBudgetMs ?? DEFAULT_COLLECTOR_BUDGET.timeBudgetMs,
    );
  }, 30_000);
});
