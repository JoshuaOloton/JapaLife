import type { NoticeMessage } from "@japalife/shared";

/**
 * Lets code that is not tied to a room (the scheduled job that pays finished
 * shifts) reach a player who happens to be connected. If nobody is listening
 * the notice is dropped: the player sees the result in their stats on return.
 * A real inbox for offline players is a product decision still to be made.
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

  publish(playerId: string, notice: NoticeMessage): void {
    for (const listener of this.listeners.get(playerId) ?? []) listener(notice);
  }
}
