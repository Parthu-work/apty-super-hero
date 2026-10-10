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
  it("takes the first heading of the main region as the primary heading", () => {
    setHtml(`
      <header><h2>Acme Portal</h2></header>
      <main><h1>Customer Overview</h1><h2>Recent Orders</h2></main>
    `);

    expect(computeFrameStateSignature(document).primaryHeading).toBe(
      "Customer Overview",
    );
  });

  it("falls back to the document's first heading when there is no main region", () => {
    setHtml("<div><h2>Recent Orders</h2></div>");

    expect(computeFrameStateSignature(document).primaryHeading).toBe(
      "Recent Orders",
    );
  });

  it("never reads the page title", () => {
    document.title = "Practice 4242424 - Patient Registration";
    setHtml("<main><h1>Registration</h1></main>");

    expect(JSON.stringify(computeFrameStateSignature(document))).not.toContain(
      "4242424",
    );
  });

  it("builds the nav trail from breadcrumbs, then the innermost selected item of each navigation container", () => {
    setHtml(`
      <nav aria-label="Breadcrumb"><ol>
        <li><a href="/">Home</a></li>
        <li><a href="/orders">Orders</a></li>
      </ol></nav>
      <nav>
        <a href="/customers">Customers</a>
        <a href="/orders" class="active"><span aria-current="page">Orders</span></a>
      </nav>
      <div role="tablist">
        <button role="tab" aria-selected="false">Summary</button>
        <button role="tab" aria-selected="true">Lines</button>
      </div>
    `);

    expect(computeFrameStateSignature(document).navTrail).toEqual([
      "Home",
      "Orders",
      "Lines",
    ]);
  });

  it("reports an empty nav trail when nothing is marked current/selected/active", () => {
    setHtml(`
      <nav>
        <a href="/customers">Customers</a>
        <a href="/orders">Orders</a>
      </nav>
    `);

    expect(computeFrameStateSignature(document).navTrail).toEqual([]);
  });

  it("does not change when only unrelated text content changes (a live counter, a clock)", () => {
    setHtml(`
      <header>Top bar</header>
      <nav><a href="/x" aria-current="page">Customers</a></nav>
      <main><h1>Customer Overview</h1><span id="counter">1</span></main>
    `);
    const before = computeFrameStateSignature(document);

    document.getElementById("counter")!.textContent = "42";

    expect(computeFrameStateSignature(document)).toEqual(before);
  });

  it("does not change when a toast with its own heading appears, inside or outside main", () => {
    setHtml(`
      <main><h1>Orders</h1><table><tr><td>1</td></tr></table></main>
    `);
    const before = computeFrameStateSignature(document);

    document
      .querySelector("main")!
      .insertAdjacentHTML(
        "afterbegin",
        '<div role="status"><h2>Saved</h2><button>Undo</button></div>',
      );
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="alert"><h1>Session expires soon</h1></div><div style="position: fixed"><button>Chat</button></div>',
    );

    expect(computeFrameStateSignature(document)).toEqual(before);
  });

  it("does not change when rows are added to a table", () => {
    setHtml("<main><table><tbody><tr><td>1</td></tr></tbody></table></main>");
    const before = computeFrameStateSignature(document);

    document
      .querySelector("tbody")!
      .insertAdjacentHTML(
        "beforeend",
        "<tr><td>2</td></tr><tr><td>3</td></tr>",
      );

    expect(computeFrameStateSignature(document).structureHash).toBe(
      before.structureHash,
    );
  });

  it("ignores the Agent's own UI", () => {
    setHtml("<main><h1>Orders</h1></main>");
    const before = computeFrameStateSignature(document);

    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div id="aipex-content-root"><h1>Agent</h1><nav><a aria-current="page">Chat</a></nav><form></form></div>',
    );

    expect(computeFrameStateSignature(document)).toEqual(before);
  });

  it("keeps a heading inside a main region that is itself a live region", () => {
    setHtml('<main aria-live="polite"><h1>Orders</h1></main>');

    expect(computeFrameStateSignature(document).primaryHeading).toBe("Orders");
  });

  it("changes the structure hash when the primary content changes shape", () => {
    setHtml("<main><table><tr><td>1</td></tr></table></main>");
    const table = computeFrameStateSignature(document).structureHash;

    setHtml("<main><form><input><button>Save</button></form></main>");

    expect(computeFrameStateSignature(document).structureHash).not.toBe(table);
  });
});
