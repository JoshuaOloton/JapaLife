/**
 * Runs async work one at a time per key. Used so two intents from the same
 * player (a double-tapped "work" button) are handled in order and cannot both
 * pass the same check. In-process only: with several server instances this
 * needs a database or Redis lock instead (Phase 5).
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}
