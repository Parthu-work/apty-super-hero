import {
  getAptyIntegrationConfig,
  watchAptyIntegrationConfig,
} from "@apty/browser-runtime";
import {
  type AptyPeer,
  peerExtensionId,
} from "@apty/browser-runtime/apty/peers";
import { useSyncExternalStore } from "react";
import {
  type ClientCheck,
  checkPeer,
  connectPeer,
} from "../services/apty-client-check";

/** ok and warning are counted facts; info is optional and neutral. */
export type ReadinessState = "ok" | "warning" | "info" | "checking";

export type PeerStatus =
  | { kind: "checking" }
  | { kind: "not-configured" }
  | { kind: "connected"; extensionId: string }
  | {
      kind: "not-answering";
      extensionId: string;
      message?: string;
      fix?: string;
    };

export type PeerStatuses = Record<AptyPeer, PeerStatus>;

export interface ReadinessFacts {
  providerConfigured: boolean;
  peers: PeerStatuses;
  /** null while the page is still being read. */
  pageInspectable: boolean | null;
}

export interface ReadinessStates {
  provider: ReadinessState;
  client: ReadinessState;
  studio: ReadinessState;
  page: ReadinessState;
}

const PEER_STATE: Record<PeerStatus["kind"], ReadinessState> = {
  checking: "checking",
  "not-configured": "info",
  connected: "ok",
  "not-answering": "warning",
};

export function readinessStates(facts: ReadinessFacts): ReadinessStates {
  return {
    provider: facts.providerConfigured ? "ok" : "warning",
    client: PEER_STATE[facts.peers.client.kind],
    studio: PEER_STATE[facts.peers.studio.kind],
    page:
      facts.pageInspectable === null
        ? "checking"
        : facts.pageInspectable
          ? "ok"
          : "warning",
  };
}

/**
 * What the setup badge counts: warnings only (a missing AI provider, a
 * configured Client or Studio that does not answer, a page that cannot be
 * inspected). A Client or Studio that was never set up is not counted.
 */
export function setupCount(states: ReadinessStates): number {
  return Object.values(states).filter((state) => state === "warning").length;
}

function statusOf(extensionId: string, check: ClientCheck): PeerStatus {
  return check.status === "ok"
    ? { kind: "connected", extensionId }
    : {
        kind: "not-answering",
        extensionId,
        message: check.message,
        ...(check.status === "not_answering" && check.fix
          ? { fix: check.fix }
          : {}),
      };
}

const PEERS: AptyPeer[] = ["client", "studio"];
const CHECKING: PeerStatuses = {
  client: { kind: "checking" },
  studio: { kind: "checking" },
};

interface PeerStoreDeps {
  getConfig: typeof getAptyIntegrationConfig;
  watchConfig: typeof watchAptyIntegrationConfig;
  check: typeof checkPeer;
  connect: typeof connectPeer;
}

/**
 * The Apty Client's and Studio's status, shared by the context bar, the
 * menu and the Connections page. Checks run when the first view subscribes
 * and again whenever the stored IDs change.
 * @internal Exported for tests; the app uses `peerStore`.
 */
export function createPeerStore(
  deps: PeerStoreDeps = {
    getConfig: getAptyIntegrationConfig,
    watchConfig: watchAptyIntegrationConfig,
    check: checkPeer,
    connect: connectPeer,
  },
) {
  let state = CHECKING;
  let run = 0;
  let unwatch: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const set = (peer: AptyPeer, status: PeerStatus) => {
    state = { ...state, [peer]: status };
    for (const listener of listeners) listener();
  };

  async function refresh(): Promise<void> {
    const current = ++run;
    const config = await deps.getConfig();
    await Promise.all(
      PEERS.map(async (peer) => {
        const id = peerExtensionId(config, peer);
        const status: PeerStatus = id
          ? statusOf(
              id,
              await deps
                .check(peer, id)
                .catch((): ClientCheck => ({ status: "error", message: "" })),
            )
          : { kind: "not-configured" };
        if (current === run) set(peer, status);
      }),
    );
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unwatch = deps.watchConfig(() => void refresh());
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unwatch?.();
          unwatch = null;
        }
      };
    },
    refresh,
    /** Saves and checks `id` for `peer`; the result is the check's. */
    async connect(peer: AptyPeer, id: string): Promise<ClientCheck> {
      run++;
      set(peer, { kind: "checking" });
      const result = await deps.connect(peer, id);
      if (result.status === "error") await refresh();
      else set(peer, statusOf(id, result));
      return result;
    },
  };
}

export const peerStore = createPeerStore();

export function usePeerStatuses(): PeerStatuses {
  return useSyncExternalStore(peerStore.subscribe, peerStore.getState);
}
