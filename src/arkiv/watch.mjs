/**
 * AskOnly — the retention monitor.
 *
 * This is the evidentiary core of the whole product, and it is also the single
 * easiest thing to get catastrophically wrong.
 *
 * THE CLAIM
 *   Arkiv emits an event when someone BUYS a record more life (`extendEntity`),
 *   and emits NOTHING when a record simply dies. So keeping a permission alive is
 *   a publicly observable, signed, on-chain act, while letting it die is silent.
 *   That inverts the burden of proof: retention becomes the thing you must explain.
 *
 * THE TRAP
 *   `watchEntityEvents` is a CHAIN-WIDE FIREHOSE. It has no schema filter, no
 *   owner filter and no key filter - it is every entity on the chain. Measured on
 *   this chain on 2026-11-05: 61 ExpiryExtended events in roughly four minutes,
 *   from nine wallets that had nothing to do with us. An unfiltered monitor
 *   presents strangers' retention as your own, which is worse than useless -
 *   it is a false accusation on stage.
 *
 *   `.ownedBy()` / `.createdBy()` exist on the QUERY builder but NOT on the
 *   subscription. So the filter has to be ours, client-side, on every event.
 *
 * NAMING
 *   `onExpiryExtended` is a handler KEY, not an event name. The event's own
 *   `type` string is "ExpiryExtended".
 */

import { scrub } from "./client.mjs";

/**
 * Watch for extensions, but only ours.
 *
 * @param reader   Arkiv public client
 * @param onExtended  called with a normalised extension record
 * @param onError     called with an already-scrubbed message
 * @param owners   addresses whose entities we care about
 * @param keys     specific entity keys we care about (a single grant, say)
 * @returns unwatch function
 */
export function watchExtensions(reader, onExtended, onError, { owners = [], keys = [] } = {}) {
  const ownerSet = new Set(owners.filter(Boolean).map((a) => String(a).toLowerCase()));
  const keySet = new Set(keys.filter(Boolean).map((k) => String(k).toLowerCase()));

  if (ownerSet.size === 0 && keySet.size === 0) {
    // Fail loudly rather than quietly showing the whole chain as ours.
    throw new Error(
      "watchExtensions refuses to run unfiltered: the subscription is chain-wide " +
        "and would report strangers' extensions as yours. Pass owners or keys.",
    );
  }

  const mine = (entityKey, owner) => {
    if (keySet.size && keySet.has(String(entityKey).toLowerCase())) return true;
    if (ownerSet.size && ownerSet.has(String(owner).toLowerCase())) return true;
    return false;
  };

  const stats = { seen: 0, kept: 0, dropped: 0 };

  const unwatch = reader.watchEntityEvents({
    onExpiryExtended: ({ entityKey, owner, expiresAt, blockNumber, transactionHash }) => {
      stats.seen += 1;
      if (!mine(entityKey, owner)) {
        stats.dropped += 1; // not ours - the stream is the whole chain
        return;
      }
      stats.kept += 1;
      onExtended({
        entityKey,
        owner,
        newExpiryBlock: expiresAt?.toString() ?? null,
        blockNumber: blockNumber?.toString() ?? null,
        txHash: transactionHash,
        at: Date.now(),
      });
    },
    onError: (e) => (onError ? onError(scrub(e)) : undefined),
  });

  return { unwatch, stats };
}

/**
 * The thing we actually show a judge: for a grant that has died, was it ever
 * extended? Natural expiry emits nothing, so a clean record is the proof that
 * nobody quietly kept the permission alive.
 *
 * This is deliberately phrased as what it is - an observation over a window -
 * rather than as a proof of absence for all time.
 */
export function retentionReport({ sinceMs, extensions, grantKey }) {
  const mine = extensions.filter(
    (e) => !grantKey || String(e.entityKey).toLowerCase() === String(grantKey).toLowerCase(),
  );
  return {
    windowStart: sinceMs,
    windowEnd: Date.now(),
    extensionsObserved: mine.length,
    quietDeath: mine.length === 0,
    statement:
      mine.length === 0
        ? "No extension event was emitted for this permission. It was allowed to die."
        : `This permission was extended ${mine.length} time(s). Each extension is a signed, public act.`,
    extensions: mine,
  };
}
