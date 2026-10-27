import type { ChatDraft } from "@apty/ui/types";

/**
 * Asks the header to start a new chat with a draft, through its own New
 * chat path (confirm a running reply, interrupt it, save, then clear).
 * Nothing is sent: the draft waits in the composer.
 */
function createChatHandoff() {
  let pending: ChatDraft | null = null;
  const listeners = new Set<() => void>();
  return {
    request(draft: ChatDraft) {
      pending = draft;
      for (const listener of listeners) listener();
    },
    /** The pending draft, once: taking it clears it. */
    take(): ChatDraft | null {
      const draft = pending;
      pending = null;
      return draft;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const chatHandoff = createChatHandoff();
