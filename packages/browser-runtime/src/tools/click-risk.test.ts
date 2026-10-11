import { afterEach, describe, expect, it, vi } from "vitest";

const mockExecuteScript = vi.hoisted(() => vi.fn());

(global as any).chrome = { scripting: { executeScript: mockExecuteScript } };

import {
  type ClickTargetInfo,
  classifyClickRisk,
  classifyNewTabUrl,
  describeClickForApproval,
  inspectClickTarget,
  NEW_TAB_MAX_QUERY_AND_FRAGMENT,
} from "./click-risk";

afterEach(() => {
  vi.resetAllMocks();
});

const PAGE = "https://app.example.com/orders";

function target(overrides: Partial<ClickTargetInfo> = {}): ClickTargetInfo {
  return {
    found: true,
    tagName: "button",
    role: "button",
    accessibleName: "Show details",
    typeAttribute: "button",
    insideForm: false,
    formAction: null,
    formMethod: null,
    href: null,
    documentUrl: PAGE,
    opaque: null,
    ...overrides,
  };
}

describe("classifyClickRisk", () => {
  it.each([
    ["a plain button", target(), false],
    [
      "a tab",
      target({
        tagName: "div",
        role: "tab",
        typeAttribute: null,
        accessibleName: "Orders",
      }),
      false,
    ],
    [
      "a same-origin link",
      target({
        tagName: "a",
        role: "link",
        typeAttribute: null,
        href: `${PAGE}/42`,
        accessibleName: "Order details",
      }),
      false,
    ],
    [
      "a typed button inside a form",
      target({ insideForm: true, accessibleName: "Add row" }),
      false,
    ],
    [
      "button[type=submit]",
      target({ typeAttribute: "submit", accessibleName: "Go" }),
      true,
    ],
    [
      "a typeless button inside a form",
      target({ typeAttribute: null, insideForm: true, accessibleName: "Go" }),
      true,
    ],
    [
      "a typeless button outside a form",
      target({ typeAttribute: null, accessibleName: "Go" }),
      false,
    ],
    [
      "input[type=submit]",
      target({
        tagName: "input",
        typeAttribute: "submit",
        accessibleName: "Go",
      }),
      true,
    ],
    [
      "input[type=image]",
      target({
        tagName: "input",
        typeAttribute: "image",
        accessibleName: "Go",
      }),
      true,
    ],
    ["a Delete button", target({ accessibleName: "Delete order" }), true],
    ["a label in another case", target({ accessibleName: "CONFIRM" }), true],
    [
      "a word only inside a longer word",
      target({ accessibleName: "Postal code lookup" }),
      false,
    ],
    [
      "a cross-origin link",
      target({
        tagName: "a",
        role: "link",
        typeAttribute: null,
        href: "https://evil.example/?d=1",
        accessibleName: "Help",
      }),
      true,
    ],
    [
      "a javascript: link",
      target({
        tagName: "a",
        role: "link",
        typeAttribute: null,
        href: "javascript:void(0)",
        accessibleName: "Help",
      }),
      true,
    ],
    [
      "a point on a frame",
      target({
        tagName: "iframe",
        role: null,
        typeAttribute: null,
        opaque: "frame",
        accessibleName: "",
      }),
      true,
    ],
    [
      "a point on a canvas",
      target({
        tagName: "canvas",
        role: null,
        typeAttribute: null,
        opaque: "canvas",
        accessibleName: "",
      }),
      true,
    ],
  ])("%s -> risky=%s", (_label, info, risky) => {
    expect(classifyClickRisk(info).risky).toBe(risky);
  });

  it("treats a target it could not find as risky", () => {
    const risk = classifyClickRisk({
      found: false,
      reason: "nothing at that point",
    });
    expect(risk).toEqual({
      risky: true,
      reasons: [
        "the click target could not be identified (nothing at that point)",
      ],
    });
  });

  it("names every reason", () => {
    const risk = classifyClickRisk(
      target({
        typeAttribute: "submit",
        insideForm: true,
        accessibleName: "Send payment",
      }),
    );
    expect(risk.reasons).toEqual([
      "it submits a form",
      'its label contains "send"',
    ]);
  });
});

describe("describeClickForApproval", () => {
  it("shows role, name, tag, form, link and page origin", () => {
    const info = target({
      typeAttribute: "submit",
      insideForm: true,
      formAction: "https://app.example.com/orders/delete",
      formMethod: "post",
      accessibleName: "Delete",
    });
    const text = describeClickForApproval(
      info,
      classifyClickRisk(info),
      `${PAGE}?q=1`,
    );
    expect(text).toContain(
      'Click "Delete" (<button type=submit>, role button)',
    );
    expect(text).toContain("Form: POST https://app.example.com/orders/delete");
    expect(text).toContain("Page: https://app.example.com");
    expect(text).not.toContain("q=1");
    expect(text).toContain("Why approval is needed: it submits a form");
  });
});

describe("classifyNewTabUrl", () => {
  const long = "x".repeat(NEW_TAB_MAX_QUERY_AND_FRAGMENT + 1);

  it.each([
    ["same origin", `${PAGE}/42`, { approval: "none" }],
    [
      "another origin",
      "https://docs.example.org/help",
      { approval: "required", rememberable: true },
    ],
    [
      "another origin with no current page",
      "https://docs.example.org/help",
      { approval: "required", rememberable: true },
      "",
    ],
    [
      "a long query on the same origin",
      `${PAGE}?d=${long}`,
      { approval: "required", rememberable: false },
    ],
    [
      "a long fragment",
      `https://docs.example.org/#${long}`,
      { approval: "required", rememberable: false },
    ],
    [
      "a query and fragment that add up past the limit",
      `https://docs.example.org/?a=${"x".repeat(70)}#${"y".repeat(70)}`,
      { approval: "required", rememberable: false },
    ],
    [
      "a data: URL",
      "data:text/html,<h1>hi</h1>",
      { approval: "required", rememberable: false },
    ],
    [
      "a javascript: URL",
      "javascript:alert(1)",
      { approval: "required", rememberable: false },
    ],
    [
      "a chrome: URL",
      "chrome://settings",
      { approval: "required", rememberable: false },
    ],
    [
      "an unparseable URL",
      "http://",
      { approval: "required", rememberable: false },
    ],
  ])("%s", (_label, url, expected, current: string | undefined = PAGE) => {
    expect(classifyNewTabUrl(url, current)).toMatchObject(expected);
  });

  it("allows a query and fragment at exactly the limit", () => {
    const url = `https://docs.example.org/?${"x".repeat(NEW_TAB_MAX_QUERY_AND_FRAGMENT)}`;
    expect(classifyNewTabUrl(url, PAGE)).toMatchObject({ rememberable: true });
  });
});

describe("inspectClickTarget", () => {
  it("looks a uid up in every frame and returns the first match", async () => {
    const found = target({ accessibleName: "In frame" });
    mockExecuteScript.mockResolvedValue([{ result: null }, { result: found }]);

    await expect(inspectClickTarget(7, { uid: "n1" })).resolves.toEqual(found);
    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 7, allFrames: true },
        args: [{ uid: "n1" }],
      }),
    );
  });

  it("looks a point up in the top frame only", async () => {
    mockExecuteScript.mockResolvedValue([{ result: target() }]);
    await inspectClickTarget(7, { x: 10, y: 20 });
    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 7, frameIds: [0] } }),
    );
  });

  it("fails closed when nothing matches or the page cannot be scripted", async () => {
    mockExecuteScript.mockResolvedValue([{ result: null }]);
    await expect(inspectClickTarget(7, { uid: "gone" })).resolves.toMatchObject(
      {
        found: false,
      },
    );

    mockExecuteScript.mockRejectedValue(
      new Error("Cannot access a chrome:// URL"),
    );
    await expect(inspectClickTarget(7, { x: 1, y: 1 })).resolves.toEqual({
      found: false,
      reason: "Cannot access a chrome:// URL",
    });
  });
});
