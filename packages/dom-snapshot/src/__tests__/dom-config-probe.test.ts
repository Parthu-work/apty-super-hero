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
    });
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
