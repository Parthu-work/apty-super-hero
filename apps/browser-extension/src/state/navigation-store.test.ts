import { describe, expect, it, vi } from "vitest";
import { createNavigationStore } from "./navigation-store";

describe("navigation store", () => {
  it("opens a page from Home and Back returns to Home", () => {
    const nav = createNavigationStore();
    nav.openPage("dom-health");
    expect(nav.getState()).toEqual({
      drawerOpen: false,
      page: "dom-health",
      origin: "home",
    });
    nav.back();
    expect(nav.getState()).toMatchObject({ page: null, drawerOpen: false });
  });

  it("closes the menu when the menu opens a page, and Back reopens it", () => {
    const nav = createNavigationStore();
    nav.openDrawer();
    nav.openPage("dom-config", "menu");
    expect(nav.getState()).toMatchObject({
      drawerOpen: false,
      page: "dom-config",
    });
    nav.back();
    expect(nav.getState()).toMatchObject({ page: null, drawerOpen: true });
  });

  it("keeps the latest page's origin when another page replaces it", () => {
    const nav = createNavigationStore();
    nav.openPage("dom-config", "menu");
    nav.openPage("connections", "home");
    nav.back();
    expect(nav.getState()).toMatchObject({ page: null, drawerOpen: false });
  });

  it("ignores Back with no page open", () => {
    const nav = createNavigationStore();
    nav.openDrawer();
    const listener = vi.fn();
    nav.subscribe(listener);
    nav.back();
    expect(listener).not.toHaveBeenCalled();
    expect(nav.getState().drawerOpen).toBe(true);
  });

  it("notifies subscribers until they unsubscribe", () => {
    const nav = createNavigationStore();
    const listener = vi.fn();
    const unsubscribe = nav.subscribe(listener);
    nav.openDrawer();
    nav.closeDrawer();
    unsubscribe();
    nav.openDrawer();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
