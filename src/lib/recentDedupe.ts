// src/lib/recentDedupe.ts
// In-memory TTL-based dedupe to avoid double-processing webhook events.
// Primary idempotency should be done via durable storage (DB unique constraints).
// This is a pragmatic second line of defense when upstream replays events with
// different ids in a short interval.

type Entry = { seenAt: number };

const MAX_ENTRIES = 5000;
const store = new Map<string, Entry>();
let lastCleanupAt = 0;

function cleanup(now: number, ttlMs: number) {
  if (ttlMs <= 0) return;
  // Throttle cleanup to avoid overhead on high throughput.
  if (now - lastCleanupAt < Math.max(1000, ttlMs)) return;
  lastCleanupAt = now;

  for (const [k, v] of store.entries()) {
    if (now - v.seenAt > ttlMs) store.delete(k);
  }

  if (store.size <= MAX_ENTRIES) return;

  // Hard cap: remove oldest entries.
  const entries = Array.from(store.entries()).sort((a, b) => a[1].seenAt - b[1].seenAt);
  const toRemove = entries.length - MAX_ENTRIES;
  for (let i = 0; i < toRemove; i++) {
    store.delete(entries[i][0]);
  }
}

// Returns true if the key has been seen within the TTL window.
export function seenRecently(key: string, ttlMs: number): boolean {
  if (!key || ttlMs <= 0) return false;

  const now = Date.now();
  cleanup(now, ttlMs);

  const existing = store.get(key);
  if (existing && now - existing.seenAt <= ttlMs) {
    return true;
  }

  store.set(key, { seenAt: now });
  // Ensure we don't grow unbounded even if cleanup is throttled.
  if (store.size > MAX_ENTRIES * 2) {
    cleanup(now, ttlMs);
  }

  return false;
}
