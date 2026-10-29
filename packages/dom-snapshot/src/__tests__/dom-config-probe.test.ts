import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { armBehaviorProbe } from "../dom-config-probe";

let clockMs = 0;
const clock = () => clockMs;
/** Let the MutationObserver deliver what happened so far, at the current clock. */
const deliver = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  clockMs = 1_000;
  document.body.innerHTML =
    '<main id="app"></main><apty-widget><div id="tip"></div></apty-widget>';
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("armBehaviorProbe", () => {
  it("groups mutations into bursts, leaving Apty's own changes out", async () => {
    const probe = armBehaviorProbe(document, { windowMs: 3_000, clock });
    const app = document.getElementById("app")!;
    const tip = document.getElementById("tip")!;

    app.append(document.createElement("p"));
    await deliver();
    clockMs += 40;
    app.setAttribute("data-state", "loading");
    await deliver();
    clockMs += 500;
    tip.textContent = "Apty step 2";
    tip.setAttribute("data-step", "2");
    await deliver();
    clockMs += 500;
    app.setAttribute("data-state", "ready");
    await deliver();
    clockMs += 2_000;
    const result = probe.capture();
    probe.disarm();

    expect(result).toEqual({
      ran: true,
      windowMs: 3_000,
      mutationBursts: [
        { durationMs: 40, mutationCount: 2 },
        { durationMs: 0, mutationCount: 1 },
      ],
      burstGapsMs: [1_000],
      eventRates: {},
      ranToCompletion: true,
      mutationSources: [
        {
          tag: "main",
          id: "app",
          attributeNames: ["data-state"],
          mutations: 3,
          callbacks: 3,
          descendants: 1,
          interactive: 0,
        },
      ],
    });
  });

  it("names the elements that keep changing, and what ignoring each would hide", async () => {
    document.body.innerHTML = `
      <header class="bar top"><span id="clock" class="clock tick">12:00</span></header>
      <form id="order"><button>Save</button></form>`;
    const probe = armBehaviorProbe(document, { clock });
    const time = document.getElementById("clock")!;
    for (let second = 1; second <= 3; second++) {
      time.textContent = `12:0${second}`;
      await deliver();
      clockMs += 1_000;
    }
    document.getElementById("order")!.setAttribute("data-dirty", "true");
    await deliver();

    const sources = probe.capture().mutationSources!;
    probe.disarm();

    expect(sources[0]).toMatchObject({
      tag: "span",
      id: "clock",
      classes: ["clock", "tick"],
      callbacks: 3,
      interactive: 0,
    });
    expect(sources.find((s) => s.id === "order")).toMatchObject({
      attributeNames: ["data-dirty"],
      interactive: 1,
    });
  });

  it("does not see a text node's own data change, as Apty's observer does not", async () => {
    document.body.innerHTML = `<span id="clock">12:00</span>`;
    const probe = armBehaviorProbe(document, { clock });

    document.getElementById("clock")!.firstChild!.textContent = "12:01";
    await deliver();

    expect(probe.capture().mutationSources).toEqual([]);
    probe.disarm();
  });

  it("leaves out changes Apty never reacts to", async () => {
    document.body.innerHTML = `<div id="pop"></div><div class="apty-player-ignored-element"><p id="inner"></p></div>`;
    const probe = armBehaviorProbe(document, { clock });

    document
      .getElementById("pop")!
      .setAttribute("data-popper-placement", "top");
    document.getElementById("inner")!.setAttribute("data-x", "1");
    await deliver();

    expect(probe.capture()).toMatchObject({
      mutationBursts: [],
      mutationSources: [],
    });
    probe.disarm();
  });

  it("watches shadow roots that exist when it is armed", async () => {
    const host = document.createElement("x-grid");
    const root = host.attachShadow({ mode: "open" });
    document.body.append(host);
    const probe = armBehaviorProbe(document, { clock });

    root.append(document.createElement("span"));
    await deliver();

    expect(probe.capture().mutationBursts).toEqual([
      { durationMs: 0, mutationCount: 1 },
    ]);
    probe.disarm();
  });

  it("counts mutations still queued when it is captured", () => {
    const probe = armBehaviorProbe(document, { clock });

    document.getElementById("app")!.append(document.createElement("p"));

    expect(probe.capture().mutationBursts).toEqual([
      { durationMs: 0, mutationCount: 1 },
    ]);
    probe.disarm();
  });

  it("reports the rate of events that actually fired, per second, and none for the rest", () => {
    const probe = armBehaviorProbe(document, { windowMs: 2_000, clock });
    const app = document.getElementById("app")!;
    for (let i = 0; i < 40; i++) {
      app.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    }
    window.dispatchEvent(new Event("resize"));
    document
      .getElementById("tip")!
      .dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    clockMs += 1_000;

    const result = probe.capture();
    probe.disarm();

    expect(result.eventRates).toEqual({ mousemove: 40, resize: 1 });
    expect(result.ranToCompletion).toBe(false);
  });

  it("stops listening once disarmed", async () => {
    const probe = armBehaviorProbe(document, { clock });
    probe.disarm();

    document.getElementById("app")!.append(document.createElement("p"));
    window.dispatchEvent(new Event("resize"));
    await deliver();

    const result = probe.capture();
    expect(result.mutationBursts).toEqual([]);
    expect(result.eventRates).toEqual({});
  });
});
