import { beforeEach, describe, expect, it } from "vitest";
import { computeFrameStateSignature } from "../health-state-signature";

function setHtml(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "";
});

describe("computeFrameStateSignature", () => {
  it("samples visible headings in document order, bounded and trimmed", () => {
    setHtml(`
      <h1>Customer Overview</h1>
      <p>Some body text</p>
      <h2>Recent Orders</h2>
    `);

    const signature = computeFrameStateSignature(document);

    expect(signature.headingSample).toEqual([
      "Customer Overview",
      "Recent Orders",
    ]);
  });

  it("finds the active navigation item inside a nav-like container", () => {
    setHtml(`
      <nav>
        <a href="/customers" aria-current="page">Customers</a>
        <a href="/orders">Orders</a>
      </nav>
    `);

    const signature = computeFrameStateSignature(document);

    expect(signature.activeNavItem).toBe("Customers");
  });

  it("reports null active nav item when nothing is marked current/selected/active", () => {
    setHtml(`
      <nav>
        <a href="/customers">Customers</a>
        <a href="/orders">Orders</a>
      </nav>
    `);

    const signature = computeFrameStateSignature(document);

    expect(signature.activeNavItem).toBeNull();
  });

  it("counts major semantic containers structurally, ignoring their live content", () => {
    setHtml(`
      <header>Top bar</header>
      <nav>Menu</nav>
      <main><table></table></main>
      <footer>Bottom bar</footer>
    `);

    const signature = computeFrameStateSignature(document);

    expect(signature.containerCounts.main).toBe(1);
    expect(signature.containerCounts.nav).toBe(1);
    expect(signature.containerCounts.header).toBe(1);
    expect(signature.containerCounts.footer).toBe(1);
    expect(signature.containerCounts.table).toBe(1);
  });

  it("does not change when only unrelated text content changes (a live counter, a clock)", () => {
    setHtml(`
      <header>Top bar</header>
      <nav><a href="/x" aria-current="page">Customers</a></nav>
      <main><h1>Customer Overview</h1><span id="counter">1</span></main>
    `);
    const before = computeFrameStateSignature(document);

    document.getElementById("counter")!.textContent = "42";
    const after = computeFrameStateSignature(document);

    expect(after).toEqual(before);
  });
});
