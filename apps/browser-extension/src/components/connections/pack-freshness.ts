/**
 * Pack freshness in the side panel (KB-RAG K27, E9): the header's "Packs:"
 * line, and which delivered packs the update banner announces. Pure rules
 * over what the KB store and delivery already hold; nothing is fetched.
 */
import type {
  KbAptyVersion,
  KbPackState,
  KbPackUnusableReason,
  KbSyncRecord,
} from "@apty/agent-core";

export type PackHeaderItem =
  | { version: KbAptyVersion; state: "ok" }
  | { version: KbAptyVersion; state: "expires"; days: number }
  | { version: KbAptyVersion; state: "expired" }
  | { version: KbAptyVersion; state: "notUsed"; reason?: KbPackUnusableReason };

const ORDER: KbAptyVersion[] = ["4.x", "5.x", "common"];
const byVersion = (a: KbPackState, b: KbPackState) =>
  ORDER.indexOf(a.aptyVersion) - ORDER.indexOf(b.aptyVersion);

export function packHeaderItems(states: KbPackState[]): PackHeaderItem[] {
  return [...states].sort(byVersion).map((state): PackHeaderItem => {
    const { usability } = state;
    const version = state.aptyVersion;
    if (!usability.usable) {
      return usability.reason === "expired"
        ? { version, state: "expired" }
        : {
            version,
            state: "notUsed",
            ...(usability.reason ? { reason: usability.reason } : {}),
          };
    }
    const days = usability.validity.daysLeft;
    return days === undefined
      ? { version, state: "ok" }
      : { version, state: "expires", days };
  });
}

/** The version and pack the SE last dismissed the banner for. */
export type SeenPacks = Partial<Record<KbAptyVersion, string>>;

export interface DeliveredPack {
  version: KbAptyVersion;
  sha256: string;
  builtAt: string;
}

/**
 * The packs in use that delivery brought (its record names the stored pack
 * and a successful check) and that the SE has not seen yet.
 */
export function deliveredPacks(
  states: KbPackState[],
  records: Partial<Record<KbAptyVersion, KbSyncRecord>>,
  seen: SeenPacks,
): DeliveredPack[] {
  return [...states].sort(byVersion).flatMap((state) => {
    const record = records[state.aptyVersion];
    const delivered =
      state.usability.usable &&
      record?.lastSuccessAt !== undefined &&
      record.sha256 === state.sha256 &&
      seen[state.aptyVersion] !== state.sha256;
    return delivered
      ? [
          {
            version: state.aptyVersion,
            sha256: state.sha256,
            builtAt: state.builtAt,
          },
        ]
      : [];
  });
}
