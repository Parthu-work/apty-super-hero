import { useSyncExternalStore } from "react";

/** A tool page; it covers the whole panel, chat and composer included. */
export type ToolPage = "dom-health" | "dom-config" | "connections";

export type NavigationOrigin = "home" | "menu";

export interface NavigationState {
  drawerOpen: boolean;
  page: ToolPage | null;
  /** Where Back returns to: the menu reopens if it opened the page. */
  origin: NavigationOrigin;
}

const INITIAL: NavigationState = {
  drawerOpen: false,
  page: null,
  origin: "home",
};

/**
 * The side panel's navigation: the left menu and at most one tool page on
 * top of the chat. It never touches a running job; a job's page can be
 * left and reopened.
 * @internal Exported for tests; the app uses `navigationStore`.
 */
export function createNavigationStore() {
  let state = INITIAL;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<NavigationState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openDrawer: () => set({ drawerOpen: true }),
    closeDrawer: () => set({ drawerOpen: false }),
    /** Opens a page and closes the menu; Back returns to `origin`. */
    openPage: (page: ToolPage, origin: NavigationOrigin = "home") =>
      set({ page, origin, drawerOpen: false }),
    back() {
      if (state.page === null) return;
      set({ page: null, drawerOpen: state.origin === "menu" });
    },
  };
}

export type NavigationStore = ReturnType<typeof createNavigationStore>;

export const navigationStore = createNavigationStore();

export function useNavigation(
  store: NavigationStore = navigationStore,
): NavigationState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
