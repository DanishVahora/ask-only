/**
 * AskOnly — prove the Arkiv write path end to end against the live chain.
 *
 *   node --env-file=.env scripts/arkiv-prove.mjs
 *
 * Writes a vault, issues a grant that dies in 90 seconds, reads both back,
 * records an access receipt and a refusal, then measures the event firehose so
 * the filter is justified by a number rather than by a comment.
 */

import { clients, account, scrub, txLink } from "../src/arkiv/client.mjs";
import {
  putVault, issueGrant, liveGrant, vaultsOf, vaultCipher,
  recordAccess, recordRefusal, accessesOf, refusalsOf, countLiveGrants, grantsOf,
} from "../src/arkiv/ledger.mjs";
import { watchExtensions } from "../src/arkiv/watch.mjs";

const sha256hex = async (bytes) => {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const acct = account();
const ctx = clients(acct);
const { reader, wallet } = ctx;
console.log(`writing wallet ${acct.address}\n`);

/* 1. a vault --------------------------------------------------------------- */
// Stand-in for what the browser produces: AES-GCM-256 ciphertext. This process
// never has the key, so to it these really are opaque bytes.
const plaintext = new TextEncoder().encode(
  "Employer: Tata Consultancy Services Ltd\nMonth: October 2026\nGross: 68000\nNet Pay: 62960\n",
);
const cipher = crypto.getRandomValues(new Uint8Array(1024)); // opaque to us by construction
const iv = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64");

console.log("[1] putVault");
const v = await putVault(ctx, {
  owner: acct.address,
  label: "Payslip - Oct 2026",
  docKind: "payslip",
  sha256: await sha256hex(plaintext),
  iv,
  cipher,
  days: 180,
});
console.log(`    vaultId=${v.vaultId} bytes=${v.bytesLen} expiresAtBlock=${v.expiresAt}`);
console.log(`    ${v.tx}`);

/* 2. a grant that dies in 90 seconds -------------------------------------- */
console.log("\n[2] issueGrant (dies in 90s)");
const g = await issueGrant(ctx, {
  vaultId: v.vaultId,
  owner: acct.address,
  verifier: "0x000000000000000000000000000000000000beef",
  verifierName: "landlord.eth",
  questionSet: "income",
  usesAllowed: 3,
  minutes: 1.5,
  threshold: "50000",
  note: "May ask whether monthly income is above INR 50,000. Three times. 90 seconds.",
});
console.log(`    grantId=${g.grantId} roleBit=${g.roleBit} expiresAtBlock=${g.expiresAt}`);
console.log(`    ${g.tx}`);

/* 3. read both back ------------------------------------------------------- */
console.log("\n[3] read back");
const got = await liveGrant(reader, g.grantId);
if (!got) throw new Error("grant not found immediately after writing");
console.log(`    grant   state=${got.state} uses=${got.usesSpent}/${got.usesAllowed} set=${got.questionSet} dies@block=${got.expiresAtBlock}`);
const vaults = await vaultsOf(reader, acct.address, 5);
console.log(`    vaults  ${vaults.length} live for this owner`);
const vc = await vaultCipher(reader, v.vaultId);
console.log(`    cipher  ${vc.cipher.length} bytes read back, iv=${vc.iv.slice(0, 10)}...`);
const roundTripped = vc.cipher.length === cipher.length && vc.cipher.every((b, i) => b === cipher[i]);
console.log(`    bytes round-tripped exactly: ${roundTripped}`);
if (!roundTripped) throw new Error("ciphertext did not round-trip - decryption would fail in the browser");

/* 4. a receipt and a refusal ---------------------------------------------- */
console.log("\n[4] recordAccess + recordRefusal");
const a = await recordAccess(ctx, {
  grantId: g.grantId,
  vaultId: v.vaultId,
  owner: acct.address,
  asker: "0x000000000000000000000000000000000000beef",
  askerName: "landlord.eth",
  question: "Is monthly income above INR 50000?",
  questionHash: await sha256hex(new TextEncoder().encode("Is monthly income above INR 50000?")),
  answer: "yes",
  answerHash: await sha256hex(new TextEncoder().encode('{"answer":"yes"}')),
  requestId: "f88d4a75-646f-42be-bf04-38532c51422c",
  provider: "0xD179F4526064846dE9a9E9D93683AF75CB72E503",
  model: "glm-5.3",
  trustMode: "private",
  verification: "provider-address",
  teeType: "TDX/dstack",
  latencyMs: 9422,
  band: "above threshold",
});
console.log(`    access  ${a.accessId}  ${a.tx}`);

const r = await recordRefusal(ctx, {
  grantId: g.grantId,
  owner: acct.address,
  asker: "0x000000000000000000000000000000000000beef",
  question: "What is their exact salary?",
  questionHash: await sha256hex(new TextEncoder().encode("What is their exact salary?")),
  reason: "out-of-set",
  detail: "The income set permits a threshold comparison, never an exact figure.",
});
console.log(`    refusal ${r.refusalId}  ${r.tx}`);

/* 5. the owner's view ----------------------------------------------------- */
console.log("\n[5] who asked about me");
for (const x of await accessesOf(reader, acct.address, 5)) {
  console.log(`    ${x.askerName} asked "${x.question}" -> ${x.answer.toUpperCase()}  [${x.verification}] req=${x.requestId.slice(0, 8)}`);
}
for (const x of await refusalsOf(reader, acct.address, 5)) {
  console.log(`    ${x.asker.slice(0, 10)}... was REFUSED "${x.question}"  reason=${x.reason}`);
}
console.log(`    live grants chain-wide: ${await countLiveGrants(reader)}`);
console.log(`    my grants: ${(await grantsOf(reader, acct.address, 10)).length}`);

/* 6. the firehose, measured ---------------------------------------------- */
console.log("\n[6] event stream - measuring the firehose for 20s");
const kept = [];
const w = watchExtensions(reader, (e) => kept.push(e), (e) => console.log(`    watch error: ${e}`), {
  owners: [acct.address],
});
await new Promise((res) => setTimeout(res, 20_000));
w.unwatch();
console.log(`    seen=${w.stats.seen}  ours=${w.stats.kept}  dropped(strangers)=${w.stats.dropped}`);
console.log(
  w.stats.dropped > 0
    ? `    ^ ${w.stats.dropped} extension(s) from other wallets would have shown as ours without the filter`
    : "    (quiet window - the filter still has to be there; the stream is chain-wide)",
);

console.log(`\nGRANT TO WATCH DIE: ${g.grantId}   (90s from issue)`);
console.log(`node --env-file=.env scripts/arkiv-expiry.mjs ${g.grantId}`);
