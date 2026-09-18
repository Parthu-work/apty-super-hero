import { beforeEach, describe, expect, it } from "vitest";
import {
  collectDiscoverableLinks,
  collectSafeNavigationCandidates,
  isSafeNavigationCandidate,
  isSafeToDiscover,
} from "../health-links";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("collectDiscoverableLinks", () => {
  it("collects same-origin links and marks them safe to discover", () => {
    setHtml(`<a href="/orders">Orders</a>`);

    const links = collectDiscoverableLinks(document);

    expect(links).toHaveLength(1);
    expect(links[0]?.sameOrigin).toBe(true);
    expect(links[0]?.looksDestructive).toBe(false);
    expect(isSafeToDiscover(links[0]!)).toBe(true);
  });

  it("never proposes a javascript:/mailto:/tel: href as a navigation target", () => {
    setHtml(`
      <a href="javascript:doSomething()">Run</a>
      <a href="mailto:test@example.com">Email</a>
      <a href="tel:+15551234567">Call</a>
      <a href="#section">Jump</a>
    `);

    const links = collectDiscoverableLinks(document);

    expect(links).toHaveLength(0);
  });

  it("flags a link as destructive by keyword and excludes it from safe discovery", () => {
    setHtml(`<a href="/orders/123/delete">Delete order</a>`);

    const links = collectDiscoverableLinks(document);

    expect(links[0]?.looksDestructive).toBe(true);
    expect(links[0]?.destructiveReason).toBe("delete");
    expect(isSafeToDiscover(links[0]!)).toBe(false);
  });

  it("flags logout/sign-out links as destructive even when the href itself looks harmless", () => {
    setHtml(
      `<a href="/session/end" aria-label="Log out of your account">Bye</a>`,
    );

    const links = collectDiscoverableLinks(document);

    expect(links[0]?.looksDestructive).toBe(true);
  });

  it("marks a cross-origin link as unsafe to discover, without treating it as destructive", () => {
    setHtml(`<a href="https://other-site.example/page">External</a>`);

    const links = collectDiscoverableLinks(document);

    expect(links[0]?.sameOrigin).toBe(false);
    expect(links[0]?.looksDestructive).toBe(false);
    expect(isSafeToDiscover(links[0]!)).toBe(false);
  });

  it("deduplicates links resolving to the same absolute URL", () => {
    setHtml(`
      <a href="/orders">Orders A</a>
      <a href="/orders">Orders B</a>
    `);

    const links = collectDiscoverableLinks(document);

    expect(links).toHaveLength(1);
  });

  it("bounds the number of links returned", () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `<a href="/page-${i}">Page ${i}</a>`,
    ).join("");
    setHtml(links);

    const result = collectDiscoverableLinks(document, { maxLinks: 3 });

    expect(result).toHaveLength(3);
  });
});

describe("collectSafeNavigationCandidates", () => {
  it("finds menu/tab/tree items that have no real href, inside a safe nav container", () => {
    setHtml(`
      <nav>
        <div role="menuitem">Customers</div>
        <div role="menuitem">Orders</div>
      </nav>
    `);

    const candidates = collectSafeNavigationCandidates(document);

    expect(candidates.map((c) => c.text)).toEqual(["Customers", "Orders"]);
    expect(candidates.every(isSafeNavigationCandidate)).toBe(true);
  });

  it("never proposes anything inside a <form>, even inside a nav-like container", () => {
    setHtml(`
      <nav>
        <form>
          <button role="menuitem">Should never appear</button>
        </form>
        <div role="menuitem">Should appear</div>
      </nav>
    `);

    const candidates = collectSafeNavigationCandidates(document);

    expect(candidates.map((c) => c.text)).toEqual(["Should appear"]);
  });

  it("never proposes a submit-like control", () => {
    setHtml(`
      <div role="tablist">
        <button type="submit" role="tab">Save and continue</button>
        <div role="tab">Details</div>
      </div>
    `);

    const candidates = collectSafeNavigationCandidates(document);

    expect(candidates.map((c) => c.text)).toEqual(["Details"]);
  });

  it("flags a destructive-looking item and excludes it from safe navigation", () => {
    setHtml(`
      <nav>
        <div role="menuitem">Delete customer</div>
      </nav>
    `);

    const candidates = collectSafeNavigationCandidates(document);

    expect(candidates[0]?.looksDestructive).toBe(true);
    expect(isSafeNavigationCandidate(candidates[0]!)).toBe(false);
  });

  it("ignores clickable-looking elements outside any safe nav container", () => {
    setHtml(`<div role="menuitem">Not inside a nav container</div>`);

    const candidates = collectSafeNavigationCandidates(document);

    expect(candidates).toHaveLength(0);
  });
});
