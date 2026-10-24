/**
 * One in-memory lock per tab for the side-panel runs that navigate it: DOM
 * Config's crawl and DOM Health's audits. A card that cannot take the lock
 * is disabled with the holder named. Runs the chat agent starts through its
 * tools do not take this lock.
 */
import { useSyncExternalStore } from "react";

export type TabLockOwner = "dom-health" | "dom-config";

const holders = new Map<number, TabLockOwner>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function tabLockHolder(tabId: number | null): TabLockOwner | null {
  return tabId === null ? null : (holders.get(tabId) ?? null);
}

/** False when another owner holds the tab. */
export function acquireTabLock(tabId: number, owner: TabLockOwner): boolean {
  const holder = holders.get(tabId);
  if (holder && holder !== owner) return false;
  holders.set(tabId, owner);
  emit();
  return true;
}

export function releaseTabLock(tabId: number, owner: TabLockOwner): void {
  if (holders.get(tabId) !== owner) return;
  holders.delete(tabId);
  emit();
}

export function useTabLockHolder(tabId: number | null): TabLockOwner | null {
  return useSyncExternalStore(subscribe, () => tabLockHolder(tabId));
}
