/**
 * AskOnly — one query, runnable by anyone, no setup.
 *
 *   node scripts/judge-query.mjs
 *
 * Reads cost no gas on Arkiv, so this needs no funded wallet and no private key.
 * If ARKIV_ACCESS_KEY is set it uses it; otherwise it falls back to the keyless
 * public endpoint, which is heavily rate limited but works for a single read.
 *
 * It shows the thing the project is actually about: the capabilities issued by
 * our writing wallet, and the fact that expired ones are simply NOT THERE.
 */

import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http } from "viem";
import { eq, and, desc } from "@arkiv-network/sdk/query";
import { str, addr } from "@arkiv-network/sdk/schema";
import { Grant, Access, Refusal } from "../src/arkiv/schema.mjs";

const WALLET = "0x4CA8176777D44B76235684b63334088C618994e4";
const accessKey = process.env.ARKIV_ACCESS_KEY ?? "";

if (!accessKey) {
  // Measured 2026-11-06: the keyless public endpoint does not reject the request,
  // it simply never answers - we gave it three minutes. Hanging is a worse
  // experience than failing, so say what to do instead of spinning.
  console.error(
    `\nThis query needs an Arkiv access key.\n\n` +
      `  1. Get one (free, ~30 seconds): https://hub.arkiv.network/access-keys\n` +
      `  2. ARKIV_ACCESS_KEY=ark_live_... node scripts/judge-query.mjs\n\n` +
      `Reads cost no gas, so the key is all you need - no funded wallet, no private key.\n` +
      `The keyless public endpoint exists but is rate limited to the point of not\n` +
      `responding, which is why this script refuses to use it rather than hanging.\n`,
  );
  process.exit(1);
}

const chain = rabdi({ accessKey });
const reader = createPublicClient({
  chain,
  // Fail in 20s rather than hanging if the endpoint is unhealthy.
  transport: http(undefined, { timeout: 20_000, retryCount: 1 }),
  cacheTime: 0,
});

console.log(`\nArkiv Rabdi · chain ${await reader.getChainId()} · block ${await reader.getBlockNumber()}`);
console.log(`writing wallet ${WALLET}`);
console.log(accessKey ? "using ARKIV_ACCESS_KEY\n" : "using the keyless public endpoint (rate limited)\n");

/* ---- THE QUERY -------------------------------------------------------------
   Capabilities issued by our wallet. Note what you will NOT see: any grant whose
   death block has passed. Arkiv stops returning an expired entity entirely, so
   "it is not in these results" IS the expiry - there is no deleted flag to trust
   and no tombstone to audit.
   -------------------------------------------------------------------------- */
const { entities } = await reader
  .select({
    $key: true,
    $expiresAt: true,
    grantId: true,
    verifierName: true,
    questionSet: true,
    state: true,
    usesAllowed: true,
    usesSpent: true,
    diesAt: true,
    threshold: true,
  })
  .from(Grant)
  .where(eq("owner", addr(WALLET)))
  .orderBy(desc("issuedAt"))
  .limit(20)
  .fetch();

console.log(`${entities.length} capability(ies) still returned by the network:\n`);
if (!entities.length) {
  console.log("  (none alive right now — every one issued has since passed its death block)\n");
}
for (const e of entities) {
  const dies = new Date(Number(e.diesAt.value));
  const left = dies.getTime() - Date.now();
  console.log(
    `  ${e.grantId.value}  ${String(e.verifierName.value).padEnd(14)} ` +
      `${String(e.questionSet.value).padEnd(11)} ${String(e.state.value).padEnd(8)} ` +
      `${e.usesSpent.value}/${e.usesAllowed.value} used  ` +
      `dies@block ${e.$expiresAt}  ${left > 0 ? `${Math.round(left / 2000)} blocks left` : "overdue"}`,
  );
}

/* Receipts, which deliberately outlive the capability that produced them. */
const answered = await reader
  .select({ accessId: true, askerName: true, question: true, answer: true, requestId: true, provider: true, verification: true })
  .from(Access)
  .where(eq("owner", addr(WALLET)))
  .orderBy(desc("at"))
  .limit(5)
  .fetch();

console.log(`\n${answered.entities.length} receipt(s) — these outlive the permission on purpose:\n`);
for (const a of answered.entities) {
  console.log(`  ${a.askerName.value} asked "${a.question.value}"`);
  console.log(`    -> ${String(a.answer.value).toUpperCase()}  req ${a.requestId.value}`);
  console.log(`    -> enclave ${a.provider.value}  verified by: ${a.verification.value}\n`);
}

/* Refusals. */
const refused = await reader
  .select({ question: true, reason: true })
  .from(Refusal)
  .where(eq("owner", addr(WALLET)))
  .orderBy(desc("at"))
  .limit(5)
  .fetch();

console.log(`${refused.entities.length} refusal(s) — questions somebody was not permitted to ask:\n`);
for (const r of refused.entities) {
  console.log(`  "${r.question.value}"  refused: ${r.reason.value}`);
}

/* A count, without fetching rows. */
const liveEverywhere = await reader.count().from(Grant).where(eq("state", str("live"))).fetch();
console.log(`\nLive capabilities chain-wide (all users): ${liveEverywhere}`);
console.log(
  `\nTry it again in a few minutes. Short-lived grants will have vanished from the\n` +
    `first list without anything being deleted — that is the whole point.\n`,
);
