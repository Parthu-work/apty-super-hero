import { describe, expect, it } from "vitest";
import {
  type AuditStateFingerprint,
  unknownStateFingerprint,
} from "./state-fingerprint.js";
import { isSameUrl, StateGraph } from "./state-graph.js";

function fp(fingerprint: string): AuditStateFingerprint {
  return { ...unknownStateFingerprint(), fingerprint };
}

describe("isSameUrl (D-2)", () => {
  it("treats a tenant, session or record id as the same URL", () => {
    expect(
      isSameUrl(
        "https://ft.example.test/WSWebClient/session/open?tenant=FAKETENANT000000_TRN&view=list",
        "https://ft.example.test/WSWebClient/session/open?view=list&tenant=FAKETENANT111111_TRN",
      ),
    ).toBe(true);
    expect(
      isSameUrl(
        "https://ehr.example.test/4242424/2/ax/registration",
        "https://ehr.example.test/1234567/2/ax/registration",
      ),
    ).toBe(true);
  });

  it("treats two hash routes as two URLs", () => {
    expect(
      isSameUrl(
        "https://app.example.test/#/orders",
        "https://app.example.test/#/customers",
      ),
    ).toBe(false);
  });
});

describe("StateGraph", () => {
  it("registers the seed state as current with no discovering edge", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    expect(graph.getCurrentStateId()).toBe(seedId);
    expect(graph.getNode(seedId)?.discoveredViaEdgeId).toBeNull();
    expect(graph.getSeedStateId()).toBe(seedId);
  });

  it("records a new state on transition and advances currentStateId", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    const { stateId, isNew, edge } = graph.recordTransition({
      sourceStateId: seedId,
      trigger: {
        kind: "click",
        frameId: 0,
        domPath: "nav > .menu-1",
        candidateText: "Menu 1",
      },
      beforeFingerprint: fp("A"),
      afterFingerprint: fp("B"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });
    expect(isNew).toBe(true);
    expect(graph.getCurrentStateId()).toBe(stateId);
    expect(edge.sourceStateId).toBe(seedId);
    expect(edge.targetStateId).toBe(stateId);
    expect(edge.sameUrl).toBe(true);
  });

  it("resolves back to the same state id when the same fingerprint recurs (never a duplicate node)", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    const first = graph.recordTransition({
      sourceStateId: seedId,
      trigger: { kind: "click", frameId: 0, domPath: "menu-1" },
      beforeFingerprint: fp("A"),
      afterFingerprint: fp("B"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });
    const second = graph.recordTransition({
      sourceStateId: first.stateId,
      trigger: { kind: "click", frameId: 0, domPath: "back-to-a" },
      beforeFingerprint: fp("B"),
      afterFingerprint: fp("A"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });
    expect(second.isNew).toBe(false);
    expect(second.stateId).toBe(seedId);
  });

  it("computes a restoration path as the ordered discovery-edge chain from the seed", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    const b = graph.recordTransition({
      sourceStateId: seedId,
      trigger: { kind: "click", frameId: 0, domPath: "menu-1" },
      beforeFingerprint: fp("A"),
      afterFingerprint: fp("B"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });
    const d = graph.recordTransition({
      sourceStateId: b.stateId,
      trigger: { kind: "click", frameId: 0, domPath: "submenu-1" },
      beforeFingerprint: fp("B"),
      afterFingerprint: fp("D"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });

    const path = graph.getRestorationPath(d.stateId);
    expect(path).toHaveLength(2);
    expect(path[0]!.targetStateId).toBe(b.stateId);
    expect(path[1]!.targetStateId).toBe(d.stateId);
  });

  it("returns an empty restoration path for the seed state itself", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    expect(graph.getRestorationPath(seedId)).toEqual([]);
  });

  it("does not create a second discovery edge for a state reached again by a different path (restoration path stays the FIRST-discovered one)", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    const b = graph.recordTransition({
      sourceStateId: seedId,
      trigger: { kind: "click", frameId: 0, domPath: "menu-1" },
      beforeFingerprint: fp("A"),
      afterFingerprint: fp("B"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });
    const c = graph.recordTransition({
      sourceStateId: seedId,
      trigger: { kind: "click", frameId: 0, domPath: "menu-2" },
      beforeFingerprint: fp("A"),
      afterFingerprint: fp("C"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });
    // A later, redundant transition from B directly to C (already known) —
    // must reuse C's existing node and must NOT change C's restoration path.
    graph.recordTransition({
      sourceStateId: b.stateId,
      trigger: { kind: "click", frameId: 0, domPath: "shortcut-to-c" },
      beforeFingerprint: fp("B"),
      afterFingerprint: fp("C"),
      url: "https://app.example.com/home",
      title: "Home",
      historyEventDelta: 0,
    });

    const pathToC = graph.getRestorationPath(c.stateId);
    expect(pathToC).toHaveLength(1);
    expect(pathToC[0]!.sourceStateId).toBe(seedId);
    expect(pathToC[0]!.trigger.domPath).toBe("menu-2");
  });

  it("marks sameUrl false when the target's URL differs from the source's", () => {
    const graph = new StateGraph();
    const seedId = graph.addSeedState(
      fp("A"),
      "https://app.example.com/home",
      "Home",
    );
    const { edge } = graph.recordTransition({
      sourceStateId: seedId,
      trigger: {
        kind: "url-navigation",
        url: "https://app.example.com/settings",
      },
      beforeFingerprint: fp("A"),
      afterFingerprint: fp("B"),
      url: "https://app.example.com/settings",
      title: "Settings",
      historyEventDelta: 0,
    });
    expect(edge.sameUrl).toBe(false);
  });
});
