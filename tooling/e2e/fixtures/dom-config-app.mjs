/**
 * The DOM Config fixture application, shared by the crawl, UI and
 * accessibility e2e files: four same-origin pages linked by anchors whose
 * `?nocache=` changes on every load, ids `ui-id-N` that change per load,
 * toolbar ids carrying a window counter that changes per load,
 * Apty's default-ignored `provCheck_` id, a long `RptTable` class run, an
 * open shadow root, a same-origin and a cross-origin iframe, an
 * extension-like icon at z-index 999999, Apty-like noise and, on /home, a
 * menu state only a click reaches. `hold(path)` keeps the next request for
 * that path waiting until released, so a run can be held in a known state.
 */
import { startServer } from "../harness.mjs";

export const PAGES = ["home", "list", "detail", "form"];
export const TITLE = "Clinic for Jane Example";

const FRAME_PAGE = `<!doctype html><html><head></head><body>
  <form id="notes-form"><textarea name="note" placeholder="Note"></textarea></form>
</body></html>`;

export async function startDomConfigApp() {
  let loads = 0;
  const holds = new Map();

  function appPage(name, crossOrigin) {
    loads += 1;
    const stamp = 1_700_000_000_000 + loads;
    const nav = PAGES.map(
      (p) => `<a href="/${p}?nocache=${stamp}">${p}</a>`,
    ).join("");
    const rows = Array.from(
      { length: 8 },
      (_, i) => `<tr class="RptTable"><td data-col="c${i}">${i}</td></tr>`,
    ).join("");
    const menu =
      name === "home"
        ? `<nav role="menu" aria-label="Sections"><div role="menuitem" id="m-reports">Reports</div></nav>`
        : "";
    const frames =
      name === "home"
        ? `<iframe id="notes" src="/frame.html"></iframe><iframe id="viewer" src="${crossOrigin}/frame.html"></iframe>`
        : "";
    return `<!doctype html><html lang="en"><head><title>${TITLE}</title></head><body>
  <nav id="main-nav">${nav}</nav>
  ${menu}
  <main id="view"><h1>${name}</h1>
    <div id="ui-id-${loads}" class="panel">a</div><div id="ui-id-${loads + 1}" class="panel">b</div>
    <div id="provCheck_1009116120" class="check">c</div>
    <div id="toolbar"><button id="win${loads}-save-button">Save</button><button id="win${loads}-close-button">Close</button></div>
    <input name="search" placeholder="Search">
    <table id="grid">${rows}</table>
    <x-card id="card"></x-card>
  </main>
  ${frames}
  <img id="pm-icon" alt="" style="position: fixed; z-index: 999999; top: 0; left: 0">
  <div id="toast" style="position: fixed; z-index: 9999"></div>
  <apty-widget><div class="tip" data-apty-step="s${loads}">Apty tip</div></apty-widget>
  <script>
    document.getElementById("card").attachShadow({ mode: "open" }).innerHTML =
      '<header class="title">Card</header><button class="card-action">Open</button>';
    const item = document.getElementById("m-reports");
    if (item) {
      item.addEventListener("click", () => {
        document.getElementById("view").innerHTML =
          '<h1>Reports</h1><div id="report-panel" class="panel">r</div>';
      });
    }
  </script>
</body></html>`;
  }

  function server(otherOrigin) {
    return startServer(async (req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      const held = holds.get(path);
      if (held) {
        holds.delete(path);
        held.markRequested();
        await held.released;
      }
      const name = path.slice(1);
      const body =
        path === "/frame.html"
          ? FRAME_PAGE
          : PAGES.includes(name)
            ? appPage(name, otherOrigin())
            : null;
      if (body === null) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(body);
    });
  }

  let crossServer;
  const main = await server(
    () => `http://localhost:${crossServer.address().port}`,
  );
  crossServer = await server(() => main.origin);

  return {
    origin: main.origin,
    crossOrigin: `http://localhost:${crossServer.address().port}`,
    /** The next request for `path` waits until `release()`; `requested` resolves when it arrives. */
    hold(path) {
      let markRequested;
      let release;
      const requested = new Promise((r) => {
        markRequested = r;
      });
      const released = new Promise((r) => {
        release = r;
      });
      holds.set(path, { markRequested, released });
      return { requested, release };
    },
    close() {
      main.close();
      crossServer.close();
    },
  };
}
