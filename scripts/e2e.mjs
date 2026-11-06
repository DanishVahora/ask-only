/**
 * AskOnly — the whole loop, end to end, against live systems.
 *
 *   node --env-file=.env scripts/e2e.mjs
 *
 * The individual proof scripts each test one layer. This one tests that they
 * compose: seal a real document, refuse an unauthorised question on-chain,
 * grant the ENS role, ask the permitted question inside a TDX enclave, write a
 * receipt bound to a signature, and watch the permission die on its own.
 *
 * Every assertion is against a live network. Nothing here is mocked except the
 * ENS registry we grant roles on, which is labelled as such.
 */

import { createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import path from "node:path";

import { clients, account, scrub } from "../src/arkiv/client.mjs";
import {
  putVault, issueGrant, liveGrant, vaultCipher,
  recordAccess, recordRefusal, accessesOf, refusalsOf, spendGrant,
} from "../src/arkiv/ledger.mjs";
import { ask, leaksDocument } from "../src/ask/enclave.mjs";
import { sha256hex } from "../src/ask/questions.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const wiring = JSON.parse(readFileSync(path.join(ROOT, "deployments.sepolia.json"), "utf8"));
const gateAbi = JSON.parse(readFileSync(path.join(ROOT, "build", "AskOnlyGate.json"), "utf8")).abi;
const mockAbi = JSON.parse(readFileSync(path.join(ROOT, "build", "MockENSRegistry.json"), "utf8")).abi;

let fails = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { fails += 1; console.log(`  FAIL  ${m}`); };
const step = (n, t) => console.log(`\n[${n}] ${t}`);

const PAYSLIP = `
Tata Consultancy Services Limited
Employee: Danish Vahora
Employee ID: TCS-442913
PAN: ABCDE1234F
Bank Account: HDFC 50100234567891
Address: 14 Hill Road, Bandra West, Mumbai 400050
Date of Joining: 2023-07-10
Month: October 2026
Basic: 42,000
HRA: 16,800
Gross: 68,000
Net Pay: 62,960
`.trim();

const acct = account();
const ctx = clients(acct);
const { reader } = ctx;

const LANDLORD = "0x000000000000000000000000000000000000bEEF";
const LABEL = "danish-e2e";
const labelId = BigInt(keccak256(toHex(LABEL)));

const sep = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC_URL) });
const sepWal = createWalletClient({
  account: privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY.startsWith("0x") ? process.env.DEPLOYER_PRIVATE_KEY : `0x${process.env.DEPLOYER_PRIVATE_KEY}`),
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL),
});
const GATE = wiring.contracts.AskOnlyGateDemo.address;
const REGISTRY = wiring.contracts.MockENSRegistry.address;
const ROLE_INCOME = BigInt(wiring.questionSets.income);

const mayAsk = (set) =>
  sep.readContract({ address: GATE, abi: gateAbi, functionName: "mayAskSet", args: [LANDLORD, labelId, set] });

console.log(`AskOnly end-to-end\n  arkiv wallet ${acct.address}\n  gate ${GATE}\n  label "${LABEL}"`);

/* ---------------------------------------------------- 1. seal ------------ */
step(1, "The owner seals a document (ciphertext only ever leaves the browser)");
// Stand-in for browser AES-GCM output: to this process it really is opaque bytes.
const cipher = crypto.getRandomValues(new Uint8Array(2048));
const v = await putVault(ctx, {
  owner: acct.address,
  label: "Payslip - Oct 2026 (e2e)",
  docKind: "payslip",
  sha256: await sha256hex(PAYSLIP),
  iv: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
  cipher,
  days: 180,
});
ok(`vault ${v.vaultId}, ${v.bytesLen} bytes, dies at block ${v.expiresAt}`);
const back = await vaultCipher(reader, v.vaultId);
if (back.cipher.length !== cipher.length || !back.cipher.every((b, i) => b === cipher[i])) {
  bad("ciphertext did not round-trip — the browser could not decrypt this");
} else ok("ciphertext round-tripped byte for byte");

/* ---------------------------------------------------- 2. refusal --------- */
step(2, "The landlord asks before holding any ENS role");
// Make sure we start from no role, whatever a previous run left behind.
await sepWal.writeContract({ address: REGISTRY, abi: mockAbi, functionName: "revokeRoles", args: [labelId, ROLE_INCOME, LANDLORD] })
  .then((h) => sep.waitForTransactionReceipt({ hash: h })).catch(() => {});
if (await mayAsk("income")) bad("the gate permits a question with no role granted");
else ok("mayAsk(income) = false — refused on-chain, before the document is touched");

const r = await recordRefusal(ctx, {
  grantId: "none",
  owner: acct.address,
  asker: LANDLORD,
  question: "Is monthly income above INR 50000?",
  questionHash: await sha256hex("Is monthly income above INR 50000?"),
  reason: "no-ens-role",
  detail: "The asker held no income role on this name at the time.",
});
ok(`refusal recorded ${r.refusalId}`);

/* ---------------------------------------------------- 3. grant role ------ */
step(3, "The owner grants the income role on-chain");
const gh = await sepWal.writeContract({ address: REGISTRY, abi: mockAbi, functionName: "grantRoles", args: [labelId, ROLE_INCOME, LANDLORD] });
const grec = await sep.waitForTransactionReceipt({ hash: gh });
// Pin the read to a block we know contains the grant: load-balanced RPC can
// otherwise answer from a node that has not applied it yet.
const after = await sep.readContract({ address: GATE, abi: gateAbi, functionName: "mayAskSet", args: [LANDLORD, labelId, "income"], blockNumber: grec.blockNumber });
if (!after) bad("role granted but the gate still refuses");
else ok(`mayAsk(income) = true at block ${grec.blockNumber} — same question, no code changed`);

const sets = await sep.readContract({ address: GATE, abi: gateAbi, functionName: "permittedSets", args: [LANDLORD, labelId], blockNumber: grec.blockNumber });
if (sets[1] || sets[2] || sets[3]) bad("granting income leaked into other question sets");
else ok("only income flipped — the grant authorises ONE question set, not access");

/* ---------------------------------------------------- 4. capability ------ */
step(4, "The owner issues a capability that dies in 90 seconds");
const g = await issueGrant(ctx, {
  vaultId: v.vaultId,
  owner: acct.address,
  verifier: LANDLORD,
  verifierName: "landlord.eth",
  questionSet: "income",
  usesAllowed: 2,
  minutes: 1.5,
  threshold: "50000",
  note: "Is monthly income above INR 50000?",
});
ok(`grant ${g.grantId}, dies at block ${g.expiresAt}`);

/* ---------------------------------------------------- 5. the ask --------- */
step(5, "The permitted question goes to a TDX enclave");
const answer = await ask({ plaintext: PAYSLIP, setName: "income", param: "50000", apiKey: process.env.ZEROG_API_KEY });
ok(`answer ${answer.answer.toUpperCase()} in ${answer.latencyMs}ms, $${answer.costUsd.toFixed(6)}`);
ok(`enclave ${answer.provider} (${answer.providerName}) ${answer.teeType}, pinned=${answer.providerPinned}`);
ok(`request id ${answer.requestId}`);
if (answer.answer !== "yes") bad(`expected yes for 68,000 > 50,000, got ${answer.answer}`);
if (leaksDocument(answer, PAYSLIP)) bad(`the answer leaked a figure: "${answer.band}" / "${answer.why}"`);
else ok("no figure from the document appears in the answer");
if (answer.minimisation.keptLines >= answer.minimisation.totalLines) bad("minimisation withheld nothing");
else ok(`the enclave saw ${answer.minimisation.keptLines} of ${answer.minimisation.totalLines} lines`);
if (answer.verification !== "provider-address") bad(`verification claims "${answer.verification}"`);
else ok('verification honestly labelled "provider-address", not "signature"');

/* ---------------------------------------------------- 6. receipt --------- */
step(6, "The receipt is written, bound to the asker");
// In the app this is the verifier's EIP-712 signature, produced in their wallet
// before the answer is rendered. Here we stand in for it with a signature over
// the same fields so the write path is exercised exactly as in production.
const askerSig = await sepWal.signMessage({
  message: `${g.grantId}|${answer.questionHash}|${answer.answerHash}|${answer.requestId}`,
});
const a = await recordAccess(ctx, {
  grantId: g.grantId, vaultId: v.vaultId, owner: acct.address,
  asker: LANDLORD, askerName: "landlord.eth",
  question: answer.question, questionHash: answer.questionHash,
  answer: answer.answer, answerHash: answer.answerHash, band: answer.band,
  requestId: answer.requestId, provider: answer.provider, model: answer.model,
  trustMode: answer.trustMode, verification: answer.verification,
  teeType: answer.teeType, latencyMs: answer.latencyMs,
  askerSig: Uint8Array.from(Buffer.from(askerSig.slice(2), "hex")),
});
ok(`receipt ${a.accessId}`);
const spent = await spendGrant(ctx, (await liveGrant(reader, g.grantId)).entityKey, { usesSpent: 0, usesAllowed: 2 });
ok(`use burned — ${spent.usesSpent}/2, state ${spent.state}`);

const mine = await accessesOf(reader, acct.address, 5);
const refs = await refusalsOf(reader, acct.address, 5);
ok(`"who asked about me" returns ${mine.length} receipt(s) and ${refs.length} refusal(s)`);

/* ---------------------------------------------------- 7. death ----------- */
step(7, "The capability is left alone, and dies");
const start = Date.now();
let alive = true;
while (alive && Date.now() - start < 180_000) {
  await new Promise((s) => setTimeout(s, 3000));
  if (!(await liveGrant(reader, g.grantId))) alive = false;
  else process.stdout.write(`\r      still queryable after ${Math.round((Date.now() - start) / 1000)}s `);
}
console.log();
if (alive) bad("the grant outlived its 90-second expiry");
else ok(`gone after ${Math.round((Date.now() - start) / 1000)}s — not returned by any query`);

const receiptStillThere = (await accessesOf(reader, acct.address, 5)).some((x) => x.accessId === a.accessId);
if (!receiptStillThere) bad("the receipt died with the capability — it should outlive it");
else ok("the receipt survives: the permission must die, the record of its use must not");

/* ---------------------------------------------------- 8. cleanup --------- */
await sepWal.writeContract({ address: REGISTRY, abi: mockAbi, functionName: "revokeRoles", args: [labelId, ROLE_INCOME, LANDLORD] })
  .then((h) => sep.waitForTransactionReceipt({ hash: h })).catch(() => {});

console.log(
  fails
    ? `\n${fails} check(s) FAILED.\n`
    : `\nEND TO END GREEN — refused, granted, asked inside a TDX enclave, receipted, expired.\n`,
);
process.exit(fails ? 1 : 0);
