import { describe, expect, it } from "vitest";
import {
  type FrameOwnerAttributes,
  frameKey,
  frameRole,
  stableFrameName,
  urlTemplate,
} from "./frame-identity";

function owner(overrides: Partial<FrameOwnerAttributes>): FrameOwnerAttributes {
  return {
    tagName: "iframe",
    name: null,
    id: null,
    title: null,
    ospId: null,
    srcAttribute: null,
    className: null,
    rendered: true,
    ...overrides,
  };
}

const LN_SRC = (tenant: string, session: string, theme = "Light") =>
  `https://eln.example.test/webui/servlet/fslogin?commonui=true&LogicalId=lid://infor.ln.ln01&inforThemeName=${theme}&inforCurrentLocale=en-GB&inforTimeZone=(UTC%2B05%3A30)&inforWorkspaceVersion=2026.09.00&inforTenantId=${tenant}&inforSessionId=${tenant}~${session}`;

describe("urlTemplate", () => {
  it("maps two athenaOne practices to the same template", () => {
    expect(
      urlTemplate("https://ehr.example.test/4242424/2/ax/non_clinician")
        .template,
    ).toBe(
      urlTemplate("https://ehr.example.test/9999999/2/ax/non_clinician")
        .template,
    );
    expect(urlTemplate("https://ehr.example.test/4242424/2/ax").template).toBe(
      "https://ehr.example.test/:id/:id/ax",
    );
  });

  it("drops LN's tenant, session, theme, locale, time-zone and version parameters", () => {
    const a = urlTemplate(
      LN_SRC("FAKETENANT000000_TRN", "00000000-0000-4000-8000-000000000000"),
    );
    const b = urlTemplate(
      LN_SRC(
        "OTHERTENANT00000_PRD",
        "11111111-1111-4111-8111-111111111111",
        "Dark",
      ),
    );

    expect(a.template).toBe(b.template);
    expect(a.template).toBe(
      "https://eln.example.test/webui/servlet/fslogin?commonui=true&LogicalId=lid://infor.ln.ln01",
    );
    expect(a.replacements.map((r) => r.placeholder)).toEqual([
      "inforTenantId=",
      "inforSessionId=",
    ]);
  });

  it("drops the brief's tenant/session/auth parameters and sorts the rest", () => {
    expect(
      urlTemplate(
        "https://ft.example.test/WSWebClient/session/open?tenant=FAKETENANT000000_TRN&view=list&sessionId=x&token=t&app=ft&record=12345",
      ).template,
    ).toBe(
      "https://ft.example.test/WSWebClient/session/open?app=ft&record=:id&view=list",
    );
  });

  it("templates an Infor tenant id used as a path segment", () => {
    expect(
      urlTemplate(
        "https://cdn.example.test/tenants/a330/faketenant000000_trn/logo/x.png",
      ).template,
    ).toBe("https://cdn.example.test/tenants/a330/:tenant/logo/x.png");
  });

  it("keeps a hash route as identity, templated, and drops a plain fragment", () => {
    expect(
      urlTemplate("https://app.example.test/#/orders/12345?tab=lines").template,
    ).toBe("https://app.example.test/#/orders/:id?tab=lines");
    expect(
      urlTemplate("https://app.example.test/#!/orders/12345").template,
    ).toBe("https://app.example.test/#!/orders/:id");
    expect(
      urlTemplate("https://app.example.test/page#section-2").template,
    ).toBe("https://app.example.test/page");
  });

  it("templates GUIDs and hex tokens but keeps words", () => {
    expect(
      urlTemplate(
        "https://app.example.test/records/0ed02443-93cd-453b-814f-ca6aeec1aa15/deadbeef12/globalframeset.esp",
      ).template,
    ).toBe("https://app.example.test/records/:id/:id/globalframeset.esp");
  });
});

describe("frameKey", () => {
  it("keys the LN app frame by data-osp-id, across GUID names and tenants", () => {
    const first = frameKey({
      frameId: 7,
      url: LN_SRC(
        "FAKETENANT000000_TRN",
        "00000000-0000-4000-8000-000000000000",
      ),
      owner: owner({
        title: "LN",
        name: "LN_44_11111111-2222-4333-8444-555555555555",
        ospId: "LN",
      }),
      position: "0/0",
    });
    const second = frameKey({
      frameId: 12,
      url: LN_SRC(
        "OTHERTENANT00000_PRD",
        "11111111-1111-4111-8111-111111111111",
      ),
      owner: owner({
        title: "LN",
        name: "LN_45_99999999-8888-4777-8666-555555555555",
        ospId: "LN",
      }),
      position: "0/0",
    });

    expect(first).toEqual({ key: "LN", source: "osp-id", stable: true });
    expect(second).toEqual(first);
  });

  it("keys the brief's Factory Track frame as ft", () => {
    expect(
      frameKey({
        frameId: 3,
        url: "https://ft.example.test/WSWebClient/session/open?tenant=X",
        owner: owner({
          title: "Factory Track",
          name: "ft_45_22222222-3333-4444-8555-666666666666",
          ospId: "ft",
        }),
        position: "0/0",
      }).key,
    ).toBe("ft");
  });

  it("falls back to the name without counter and GUID, then the id", () => {
    expect(stableFrameName("LN_44_11111111-2222-4333-8444-555555555555")).toBe(
      "LN",
    );
    expect(stableFrameName("ft_45_22222222-3333-4444-8555-666666666666")).toBe(
      "ft",
    );
    expect(stableFrameName("12_34")).toBeNull();
    for (const id of ["GlobalNav", "GlobalWrapper", "Status"]) {
      expect(
        frameKey({
          frameId: 2,
          url: "about:blank",
          owner: owner({ id }),
          position: "0/1",
        }),
      ).toEqual({ key: id, source: "id", stable: true });
    }
  });

  it("uses origin and URL template, and marks a positional key unstable", () => {
    expect(
      frameKey({
        frameId: 4,
        url: "https://ehr.example.test/4242424/2/statusbar.esp",
        owner: null,
        position: "0/2",
      }),
    ).toEqual({
      key: "https://ehr.example.test/:id/:id/statusbar.esp",
      source: "url-template",
      stable: true,
    });
    expect(
      frameKey({
        frameId: 5,
        url: "about:blank",
        owner: null,
        position: "0/3",
      }),
    ).toEqual({ key: "position:0/3", source: "position", stable: false });
  });
});

describe("frameRole", () => {
  const base = {
    frameId: 3,
    url: "https://ehr.example.test/4242424/2/x.esp",
    elementCount: 40,
  };

  it("classifies athenaOne's shims and a javascript: frame as shims", () => {
    expect(
      frameRole({
        ...base,
        owner: owner({
          id: "searchmenuiframe",
          className: "shimiframe",
          rendered: false,
        }),
      }).role,
    ).toBe("shim");
    expect(
      frameRole({
        ...base,
        owner: owner({ id: "patientsmenuiframe", className: "shimiframe" }),
      }).role,
    ).toBe("shim");
    expect(
      frameRole({
        ...base,
        url: "javascript:document.open()",
        owner: owner({ id: "GlobalWrapper" }),
      }).role,
    ).toBe("shim");
  });

  it("classifies GlobalNav and Status as chrome and GlobalWrapper as the application", () => {
    expect(frameRole({ ...base, owner: owner({ id: "GlobalNav" }) }).role).toBe(
      "chrome",
    );
    expect(frameRole({ ...base, owner: owner({ id: "Status" }) }).role).toBe(
      "chrome",
    );
    expect(
      frameRole({ ...base, owner: owner({ id: "GlobalWrapper" }) }).role,
    ).toBe("application");
  });

  it("calls an empty about:blank frame a placeholder, never an empty application", () => {
    expect(
      frameRole({
        ...base,
        url: "about:blank",
        elementCount: 0,
        owner: owner({ id: "GlobalNav" }),
      }),
    ).toEqual({
      role: "placeholder",
      reason: "about:blank with no content and no src yet.",
    });
    expect(
      frameRole({
        ...base,
        url: "about:blank",
        elementCount: 12,
        owner: owner({ id: "GlobalWrapper" }),
      }).role,
    ).toBe("application");
  });

  it("classifies a digital-adoption overlay frame as an overlay", () => {
    expect(
      frameRole({
        ...base,
        owner: owner({ id: "_pendo-guide-container", ignoredBy: "id:_pendo-" }),
      }).role,
    ).toBe("overlay");
  });

  it("treats athenaOne's javascript: stub as a shim only while the stub is showing", () => {
    const stub = owner({
      id: "GlobalWrapper",
      srcAttribute: "javascript:document.open(); document.close();",
    });

    expect(
      frameRole({
        ...base,
        url: "about:blank",
        elementCount: 3,
        interactiveCount: 0,
        owner: stub,
      }).role,
    ).toBe("shim");
    expect(
      frameRole({
        ...base,
        url: "https://ehr.example.test/4242424/2/globaliframe.esp",
        owner: stub,
      }).role,
    ).toBe("application");
  });
});
