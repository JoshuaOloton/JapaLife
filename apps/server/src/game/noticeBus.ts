import type { NoticeMessage } from "@japalife/shared";

/**
 * Lets code that is not tied to a room (the scheduled job that pays finished
 * shifts) reach a player who happens to be connected. If nobody is listening
 * the toast is dropped; the InboxService has stored it for when they return.
 * Game code publishes through `InboxService.deliver`, not here.
 */
export class NoticeBus {
  private readonly listeners = new Map<string, Set<(notice: NoticeMessage) => void>>();

  subscribe(playerId: string, listener: (notice: NoticeMessage) => void): () => void {
    let set = this.listeners.get(playerId);
    if (!set) {
      set = new Set();
      this.listeners.set(playerId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(playerId);
    };
  }

  /** Whether the player is connected to a room in this process right now. */
  isListening(playerId: string): boolean {
    return this.listeners.has(playerId);
  }

  publish(playerId: string, notice: NoticeMessage): void {
    for (const listener of this.listeners.get(playerId) ?? []) listener(notice);
  }
}
