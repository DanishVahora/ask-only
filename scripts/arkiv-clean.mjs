/**
 * AskOnly — wipe our own test data off Rabdi.
 *
 *   node --env-file=.env scripts/arkiv-clean.mjs          # list what is there
 *   node --env-file=.env scripts/arkiv-clean.mjs --delete # actually delete it
 *
 * Only touches entities created by OUR writing wallet. Everything readable on
 * Arkiv is public and the chain is shared, so a cleanup script that deleted by
 * schema alone would be reaching into other people's records — it filters on
 * $creator and refuses anything else.
 *
 * Note what this is NOT: a demonstration of deletion. AskOnly's whole argument
 * is that you cannot prove you deleted something. This is housekeeping before a
 * test run, and the product never asks anyone to trust a delete.
 */

import { eq } from "@arkiv-network/sdk/query";
import { addr } from "@arkiv-network/sdk/schema";
import { clients, account, scrub } from "../src/arkiv/client.mjs";
import { Vault, Grant, Access, Refusal, Request } from "../src/arkiv/schema.mjs";

const DO_IT = process.argv.includes("--delete");

const acct = account();
const ctx = clients(acct);
const { reader, wallet } = ctx;
const ME = acct.address.toLowerCase();

const SCHEMAS = [
  ["vault", Vault, { vaultId: true, label: true }],
  ["grant", Grant, { grantId: true, verifierName: true, state: true }],
  ["access", Access, { accessId: true, answer: true }],
  ["refusal", Refusal, { refusalId: true, reason: true }],
  ["request", Request, { requestId: true, state: true }],
];

console.log(`\nwallet ${acct.address}`);
console.log(DO_IT ? "mode: DELETE\n" : "mode: list only (pass --delete to remove)\n");

const found = [];

for (const [name, Schema, cols] of SCHEMAS) {
  let rows = [];
  try {
    const { entities } = await reader
      .select({ $key: true, $creator: true, ...cols })
      .from(Schema)
      .where(eq("owner", addr(acct.address)))
      .limit(100)
      .fetch();
    rows = entities;
  } catch (e) {
    console.log(`  ${name.padEnd(8)} query failed: ${scrub(e)}`);
    continue;
  }

  // Belt and braces: never delete something we did not create, even though the
  // query already filtered on the owner column.
  const mine = rows.filter((e) => String(e.$creator).toLowerCase() === ME);
  const notMine = rows.length - mine.length;

  const label = (e) =>
    Object.keys(cols)
      .map((k) => e[k]?.value)
      .filter(Boolean)
      .join(" · ");

  console.log(`  ${name.padEnd(8)} ${String(mine.length).padStart(3)} mine${notMine ? `  (${notMine} skipped — not created by us)` : ""}`);
  for (const e of mine) console.log(`           ${label(e)}`);
  found.push(...mine.map((e) => ({ name, key: e.$key, label: label(e) })));
}

if (!found.length) {
  console.log("\nNothing of ours on the chain. Clean slate already.\n");
  process.exit(0);
}

if (!DO_IT) {
  console.log(`\n${found.length} entity(ies). Re-run with --delete to remove them.\n`);
  process.exit(0);
}

console.log(`\ndeleting ${found.length}…\n`);
let ok = 0;
let failed = 0;
for (const f of found) {
  try {
    // Object form, like extendEntity. Positional args throw an unrelated error.
    await wallet.deleteEntity({ entityKey: f.key }, { gas: 1_000_000n });
    ok += 1;
    console.log(`  gone   ${f.name.padEnd(8)} ${f.label}`);
  } catch (e) {
    failed += 1;
    console.log(`  kept   ${f.name.padEnd(8)} ${f.label} — ${scrub(e)}`);
  }
}

console.log(`\n${ok} deleted, ${failed} failed.`);
console.log(
  failed
    ? "Anything that failed has probably already expired, which is the same outcome.\n"
    : "Clean slate.\n",
);
