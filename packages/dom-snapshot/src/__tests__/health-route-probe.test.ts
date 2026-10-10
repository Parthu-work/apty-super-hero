import { describe, expect, it } from "vitest";
import {
  collectRouteProbeFrameSignals,
  findActiveNavItemDeep,
  findFirstHeadingDeep,
} from "../health-route-probe";
import { loadErpFixture } from "./fixtures/erp/load-fixture";
import { ATHENA, INFOR } from "./fixtures/erp/values";

describe("collectRouteProbeFrameSignals", () => {
  it("reads LN's active tab through its slotted label and reports the app frame's identity attributes", () => {
    loadErpFixture("infor-portal-workspace");

    const signals = collectRouteProbeFrameSignals(document);

    expect(signals.title).toBe("LN");
    expect(signals.activeNavItem).toBe("LN");
    expect(signals.owners).toHaveLength(1);
    expect(signals.owners[0]).toMatchObject({
      tagName: "iframe",
      title: INFOR.lnFrame.title,
      name: INFOR.lnFrame.name,
      ospId: INFOR.lnFrame.ospId,
      rendered: true,
    });
  });

  it("never reports the selected item of a closed menu as navigation state", () => {
    loadErpFixture("infor-ids-shadow");

    expect(findActiveNavItemDeep(document)).toBeNull();

    loadErpFixture("infor-ids-shadow", {
      transform: (html) =>
        html.replace(
          'trigger-type="click" align="bottom, right" hidden=""',
          'trigger-type="click" align="bottom, right"',
        ),
    });
    expect(findActiveNavItemDeep(document)).toBe("Light");
  });

  it("finds a heading that exists only inside a shadow root", () => {
    loadErpFixture("athena-forge-panel");

    expect(document.querySelector("h1, h2, h3")).toBeNull();
    expect(findFirstHeadingDeep(document)).toBe("Contact Details");
  });

  it("reports athenaOne frames navigated from script with no src, and hidden shims as not rendered", () => {
    loadErpFixture("athena-search-state");

    const owners = collectRouteProbeFrameSignals(document).owners;
    const byId = new Map(owners.map((owner) => [owner.id, owner]));

    for (const id of ATHENA.frameIds) {
      expect(byId.get(id)).toMatchObject({
        srcAttribute: null,
        rendered: true,
      });
    }
    for (const id of ATHENA.shimFrameIds) {
      expect(byId.get(id)).toMatchObject({ rendered: false });
    }
  });
});
