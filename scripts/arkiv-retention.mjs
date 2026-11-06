/**
 * AskOnly — prove retention is LOUD.
 *
 *   node --env-file=.env scripts/arkiv-retention.mjs
 *
 * The expiry script proved that silence means death. This proves the other half:
 * that buying a permission more life emits a public, signed event which our
 * owner-filtered monitor actually catches. Without both halves the claim
 * "extension is loud, death is silent" is only half-tested.
 */

import { clients, account, scrub } from "../src/arkiv/client.mjs";
import { issueGrant, extendGrant, liveGrant } from "../src/arkiv/ledger.mjs";
import { watchExtensions } from "../src/arkiv/watch.mjs";

const acct = account();
const ctx = clients(acct);
const { reader } = ctx;

const caught = [];
const w = watchExtensions(reader, (e) => caught.push(e), (e) => console.log(`watch error: ${e}`), {
  owners: [acct.address],
});

console.log("[1] issue a grant that dies in 3 minutes");
const g = await issueGrant(ctx, {
  vaultId: "v-retention-demo",
  owner: acct.address,
  verifier: "0x000000000000000000000000000000000000beef",
  verifierName: "landlord.eth",
  questionSet: "income",
  usesAllowed: 1,
  minutes: 3,
  threshold: "50000",
  note: "Retention test.",
});
const before = await liveGrant(reader, g.grantId);
console.log(`    ${g.grantId} dies at block ${before.expiresAtBlock}`);

console.log("\n[2] quietly buy it 7 more days - the act we want to be impossible to hide");
const ext = await extendGrant(ctx, before.entityKey, { days: 7 });
console.log(`    extended to block ${ext.expiresAt}`);
console.log(`    ${ext.tx}`);

console.log("\n[3] wait 24s for the monitor to see it");
await new Promise((r) => setTimeout(r, 24_000));
w.unwatch();

const ours = caught.filter(
  (e) => String(e.entityKey).toLowerCase() === String(before.entityKey).toLowerCase(),
);

console.log(`\n    chain-wide events seen : ${w.stats.seen}`);
console.log(`    kept by owner filter   : ${w.stats.kept}`);
console.log(`    dropped (strangers)    : ${w.stats.dropped}`);
console.log(`    matching THIS grant    : ${ours.length}`);

if (ours.length === 0) {
  console.log(`\nFAIL - our own extension was not observed. The retention claim is untested.`);
  process.exit(1);
}
for (const e of ours) {
  console.log(`\n    EXTENSION OBSERVED`);
  console.log(`      entity    ${e.entityKey}`);
  console.log(`      owner     ${e.owner}`);
  console.log(`      new death block ${e.newExpiryBlock}`);
  console.log(`      block     ${e.blockNumber}`);
  console.log(`      tx        ${e.txHash}`);
}
console.log(
  `\nPROVEN: extension is a public signed act; natural death emits nothing.\n` +
    `Both halves of "retention is loud, death is silent" are now measured, not asserted.`,
);
