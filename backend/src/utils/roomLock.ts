/**
 * Per-room async mutex.
 *
 * Serializes critical sections that mutate game state for a given room so two
 * concurrent socket/REST requests cannot both pass a check-then-act guard
 * (double card play, double briscola, double game-start, etc.).
 *
 * Implementation: each room key has a "tail" promise; `withRoomLock` chains
 * its work onto that tail and updates the tail to itself. Errors are swallowed
 * by the chain so they don't poison subsequent waiters.
 */

const tails = new Map<string, Promise<unknown>>();

export function withRoomLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Track the chain tail without propagating errors to future waiters.
  const tail = next.catch(() => undefined);
  tails.set(key, tail);
  // Best-effort cleanup once we're the trailing tail with nothing queued behind.
  void tail.then(() => {
    if (tails.get(key) === tail) {
      tails.delete(key);
    }
  });
  return next;
}
