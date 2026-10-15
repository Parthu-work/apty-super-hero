import { describe, expect, it } from "vitest";
import { isLocalImageUrl, rehypeBlockRemoteMedia } from "./safe-media";

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const el = (
  tagName: string,
  properties: Record<string, unknown> = {},
  children: Node[] = [],
): Node => ({ type: "element", tagName, properties, children });

function run(...children: Node[]): Node {
  const tree: Node = { type: "root", children };
  rehypeBlockRemoteMedia()(tree);
  return tree;
}

describe("isLocalImageUrl", () => {
  it.each([
    ["data:image/png;base64,AAAA", true],
    ["DATA:image/svg+xml,<svg/>", true],
    ["blob:chrome-extension://abc/123", true],
    ["https://evil.test/x.png", false],
    ["//evil.test/x.png", false],
    ["data:text/html,<script>", false],
    ["javascript:alert(1)", false],
    ["", false],
    [undefined, false],
  ])("%s → %s", (url, expected) => {
    expect(isLocalImageUrl(url)).toBe(expected);
  });
});

describe("rehypeBlockRemoteMedia", () => {
  it("keeps a data: image and strips its srcset", () => {
    const tree = run(
      el("img", {
        src: "data:image/png;base64,AA",
        srcSet: "https://e.test 1x",
      }),
    );
    expect(tree.children?.[0]?.properties).toEqual({
      src: "data:image/png;base64,AA",
    });
  });

  it("replaces a remote image with its alt text", () => {
    const tree = run(el("img", { src: "https://e.test/a.png", alt: "chart" }));
    const span = tree.children?.[0];
    expect(span?.tagName).toBe("span");
    expect(span?.children?.[0]?.value).toBe("[chart]");
  });

  it("falls back to the label when a remote image has no alt", () => {
    const tree: Node = {
      type: "root",
      children: [el("img", { src: "https://e.test/a.png" })],
    };
    rehypeBlockRemoteMedia({ blockedImageLabel: "Bild" })(tree);
    expect(tree.children?.[0]?.children?.[0]?.value).toBe("[Bild]");
  });

  it("drops nested fetching elements and unwraps <picture>", () => {
    const tree = run(
      el("p", {}, [
        el("picture", {}, [
          el("source", { srcSet: "https://e.test" }),
          el("img", { src: "blob:x", alt: "a" }),
        ]),
        el("svg", {}, [el("image", { href: "https://e.test" })]),
      ]),
    );
    const p = tree.children?.[0];
    expect(p?.children?.map((c) => c.tagName)).toEqual(["img", "svg"]);
    expect(p?.children?.[1]?.children).toEqual([]);
  });

  it("removes a style attribute that fetches but keeps a plain one", () => {
    const tree = run(
      el("div", { style: "background: URL ( https://e.test )" }),
      el("div", { style: "color: red" }),
    );
    expect(tree.children?.[0]?.properties).toEqual({});
    expect(tree.children?.[1]?.properties).toEqual({ style: "color: red" });
  });

  it("removes a remote src from a non-image element", () => {
    const tree = run(el("input", { type: "image", src: "https://e.test" }));
    expect(tree.children?.[0]?.properties).toEqual({ type: "image" });
  });
});
