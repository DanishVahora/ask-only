/**
 * AskOnly — watch a permission die, and prove nobody kept it alive.
 *
 *   node --env-file=.env scripts/arkiv-expiry.mjs <grantId>
 *
 * This is the claim the whole project rests on, so it is a measurement and not
 * a comment. We poll the live chain for the grant until the network stops
 * returning it, then we try to USE it and show that every operation fails.
 *
 * What we may say:  past the death block, queries do not return it and every
 *                   operation on it fails.
 * What we may NOT say: that the bytes were erased from history. Arkiv's docs do
 *                   not claim that, so neither do we.
 */

import { clients, account, scrub, expiry } from "../src/arkiv/client.mjs";
import { liveGrant } from "../src/arkiv/ledger.mjs";
import { Grant } from "../src/arkiv/schema.mjs";
import { watchExtensions, retentionReport } from "../src/arkiv/watch.mjs";
import { str } from "@arkiv-network/sdk/schema";

const grantId = process.argv[2];
if (!grantId) {
  console.error("usage: node --env-file=.env scripts/arkiv-expiry.mjs <grantId>");
  process.exit(1);
}

const acct = account();
const ctx = clients(acct);
const { reader, wallet } = ctx;

const started = Date.now();
const extensions = [];
const w = watchExtensions(reader, (e) => extensions.push(e), () => {}, { owners: [acct.address] });

const first = await liveGrant(reader, grantId);
if (!first) {
  console.log(`${grantId} is already gone from the network.`);
  w.unwatch();
  process.exit(0);
}
console.log(`watching ${grantId}`);
console.log(`  entity      ${first.entityKey}`);
console.log(`  dies at     block ${first.expiresAtBlock}`);
console.log(`  state       ${first.state}, uses ${first.usesSpent}/${first.usesAllowed}\n`);

let alive = true;
let lastBlock = 0n;
while (alive) {
  const block = await reader.getBlockNumber();
  const got = await liveGrant(reader, grantId);
  if (block !== lastBlock) {
    const left = BigInt(first.expiresAtBlock) - block;
    process.stdout.write(
      `\r  block ${block}  ${got ? "QUERYABLE" : "GONE     "}  ${left > 0n ? `${left} blocks to live ` : "past death block "}`,
    );
    lastBlock = block;
  }
  if (!got) alive = false;
  else await new Promise((r) => setTimeout(r, 2000));
}

console.log(`\n\nThe grant is no longer returned by the network.`);
console.log(`  elapsed ${((Date.now() - started) / 1000).toFixed(0)}s`);

/* Now try to USE it. Every one of these must fail. */
console.log(`\nTrying to use the dead permission:`);

const expectFail = async (label, fn) => {
  try {
    await fn();
    console.log(`  !! ${label} SUCCEEDED - the expiry claim would be false`);
    return false;
  } catch (e) {
    console.log(`  ok ${label} failed: ${scrub(e)}`);
    return true;
  }
};

let allFailed = true;
allFailed &= await expectFail("read it by id", async () => {
  const g = await liveGrant(reader, grantId);
  if (!g) throw new Error("not returned by any query");
  return g;
});
allFailed &= await expectFail("patch its state", () =>
  wallet.patchEntity(Grant, first.entityKey, { set: { state: str("revoked") } }, { gas: 1_000_000n }),
);
// extendEntity takes an OBJECT ({ entityKey, expiration }), not positional args.
// Getting that wrong throws InvalidExpiryError, which would have made this test
// pass for the wrong reason - a false proof is worse than no proof.
allFailed &= await expectFail("extend its life", () =>
  wallet.extendEntity(
    { entityKey: first.entityKey, expiration: expiry.days(7) },
    { gas: 1_000_000n },
  ),
);

/* And the evidentiary part: was it ever extended while we watched? */
w.unwatch();
const report = retentionReport({ sinceMs: started, extensions, grantKey: first.entityKey });
console.log(`\nRetention report for ${first.entityKey}:`);
console.log(`  chain-wide extension events seen : ${w.stats.seen}`);
console.log(`  belonging to this owner          : ${w.stats.kept}`);
console.log(`  belonging to THIS permission     : ${report.extensionsObserved}`);
console.log(`  ${report.statement}`);
console.log(
  `\n  (Natural expiry emits no event at all. Only extendEntity does. So silence\n` +
    `   is death, and keeping a permission alive is the act that leaves a trace.)`,
);

process.exit(allFailed ? 0 : 1);
