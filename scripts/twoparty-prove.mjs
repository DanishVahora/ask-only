/**
 * AskOnly — prove the two-party protocol, including that the server cannot
 * author a record it pays for.
 *
 *   node --env-file=.env scripts/twoparty-prove.mjs
 *
 * Two independent wallets stand in for two people on two machines. Neither is
 * the server's wallet. The server pays every Arkiv write and verifies an
 * EIP-712 signature from the claimed party before it does.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sealedBody } from "./seal.mjs";
import {
  GrantTypesV1 as GrantTypes, RequestTypes, AnswerTypes, grantMessage, requestMessage, answerMessage, domain,
} from "../src/auth/typed.mjs";

const BASE = process.env.ASKONLY_URL || "http://localhost:5173";

let fails = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { fails += 1; console.log(`  FAIL  ${m}`); };
const step = (n, t) => console.log(`\n[${n}] ${t}`);

const api = async (path, opts = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.body ? "POST" : "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

const sha256hex = async (t) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/* Two people. Fresh keys, so neither is the server and neither is the other. */
const OWNER = privateKeyToAccount(generatePrivateKey());
const LANDLORD = privateKeyToAccount(generatePrivateKey());
const STRANGER = privateKeyToAccount(generatePrivateKey());

console.log(`AskOnly two-party protocol\n  owner    ${OWNER.address}\n  landlord ${LANDLORD.address}\n  stranger ${STRANGER.address}`);

const spec = await api("/api/spec");
console.log(`  paymaster ${spec.data.paymaster?.address}`);
if (spec.data.paymaster?.address?.toLowerCase() === OWNER.address.toLowerCase()) {
  bad("the owner IS the server wallet - that is the single-party bug");
} else {
  ok("the owner is not the server wallet");
}

/* ---------------------------------------------------- 1. seal ------------ */
step(1, "Owner seals a document");
const cipher = crypto.getRandomValues(new Uint8Array(1024));
const vault = await api("/api/vault", {
  body: await sealedBody(OWNER, { label: "Payslip - two-party test", docKind: "payslip", cipher, days: 180 }),
});
if (vault.status !== 200) { bad(`vault write failed: ${vault.data.error}`); process.exit(1); }
ok(`vault ${vault.data.vaultId} stored for the owner`);

/* ------------------------------------------- 2. the forgery is refused --- */
step(2, "The server is asked to write a grant it was NOT given a signature for");
const QUESTION = "Is monthly income above INR 50000?";
const diesAt = Date.now() + 10 * 60_000;
const terms = {
  vaultId: vault.data.vaultId,
  verifier: LANDLORD.address,
  questionSet: "income",
  question: QUESTION,
  usesAllowed: 2,
  diesAt,
};

const forged = await api("/api/grant", {
  body: { ...terms, owner: OWNER.address, ownerSig: "0x" + "11".repeat(65), minutes: 10 },
});
if (forged.status === 200) bad("a grant with a junk signature was accepted - the paymaster is NOT honest");
else ok(`junk signature refused (${forged.status}): ${String(forged.data.error).slice(0, 70)}…`);

/* Someone else signing the owner's terms must also fail. */
const wrongSigner = await LANDLORD.signTypedData({
  domain, types: GrantTypes, primaryType: "Grant", message: grantMessage(terms),
});
const impersonated = await api("/api/grant", {
  body: { ...terms, owner: OWNER.address, ownerSig: wrongSigner, minutes: 10 },
});
if (impersonated.status === 200) bad("the landlord successfully issued a grant AS the owner");
else ok(`impersonation refused (${impersonated.status})`);

/* ---------------------------------------------------- 3. real grant ------ */
step(3, "Owner signs the terms in their own wallet");
const ownerSig = await OWNER.signTypedData({
  domain, types: GrantTypes, primaryType: "Grant", message: grantMessage(terms),
});
const grant = await api("/api/grant", { body: { ...terms, owner: OWNER.address, ownerSig, minutes: 10 } });
if (grant.status !== 200) { bad(`grant failed: ${grant.data.error}`); process.exit(1); }
ok(`grant ${grant.data.grantId} issued, dies at block ${grant.data.expiresAt}`);

/* ------------------------------------------- 4. a stranger cannot ask ---- */
step(4, "A stranger tries to use the landlord's permission");
const qHash = await sha256hex(QUESTION);
const askedAt = Date.now();
const strangerSig = await STRANGER.signTypedData({
  domain, types: RequestTypes, primaryType: "Request",
  message: requestMessage({ grantId: grant.data.grantId, questionHash: qHash, askedAt }),
});
const strangerAsk = await api("/api/request", {
  body: { grantId: grant.data.grantId, question: QUESTION, questionHash: qHash, askedAt, asker: STRANGER.address, askerSig: strangerSig },
});
if (strangerAsk.status === 200) bad("a stranger used someone else's permission");
else ok(`stranger refused (${strangerAsk.status}): ${String(strangerAsk.data.error).slice(0, 60)}…`);

/* ---------------------------------------------------- 5. the ask --------- */
step(5, "The landlord asks - and can only ask, never answer");
const askerSig = await LANDLORD.signTypedData({
  domain, types: RequestTypes, primaryType: "Request",
  message: requestMessage({ grantId: grant.data.grantId, questionHash: qHash, askedAt }),
});
const request = await api("/api/request", {
  body: { grantId: grant.data.grantId, question: QUESTION, questionHash: qHash, askedAt, asker: LANDLORD.address, askerSig },
});
if (request.status !== 200) { bad(`request failed: ${request.data.error}`); process.exit(1); }
ok(`request ${request.data.requestId} is ${request.data.state} - waiting on the owner`);

/* ------------------------------------------- 6. it lands in the inbox ---- */
step(6, "It appears in the owner's inbox, and nobody else's");
const inbox = await api(`/api/inbox?owner=${OWNER.address}`);
const mine = inbox.data.pending?.find((x) => x.requestId === request.data.requestId);
if (!mine) bad("the request did not appear in the owner's inbox");
else ok(`inbox shows "${mine.question}" from ${mine.askerName || mine.asker.slice(0, 10)}`);

const otherInbox = await api(`/api/inbox?owner=${STRANGER.address}`);
if ((otherInbox.data.pending ?? []).some((x) => x.requestId === request.data.requestId)) {
  bad("the request leaked into a stranger's inbox");
} else ok("a stranger's inbox does not show it");

/* ------------------------------------------- 7. only the owner answers --- */
step(7, "The landlord tries to answer their own question");
const answerHash = await sha256hex(JSON.stringify({ answer: "yes", band: "comfortably above" }));
const selfAnswer = await LANDLORD.signTypedData({
  domain, types: AnswerTypes, primaryType: "Answer",
  message: answerMessage({
    requestId: request.data.requestId, grantId: grant.data.grantId,
    questionHash: qHash, answerHash, enclaveRequestId: "forged",
  }),
});
const cheat = await api("/api/answer", {
  body: {
    requestId: request.data.requestId, owner: LANDLORD.address, ownerSig: selfAnswer,
    decision: "answered", answer: "yes", answerHash, enclaveRequestId: "forged",
  },
});
if (cheat.status === 200) bad("the ASKER answered their own question - the protocol is broken");
else ok(`asker cannot answer (${cheat.status}): ${String(cheat.data.error).slice(0, 60)}…`);

/* ---------------------------------------------------- 8. owner answers --- */
step(8, "The owner's device answers");
const realAnswerSig = await OWNER.signTypedData({
  domain, types: AnswerTypes, primaryType: "Answer",
  message: answerMessage({
    requestId: request.data.requestId, grantId: grant.data.grantId,
    questionHash: qHash, answerHash, enclaveRequestId: "req-abc123",
  }),
});
const answered = await api("/api/answer", {
  body: {
    requestId: request.data.requestId, owner: OWNER.address, ownerSig: realAnswerSig,
    decision: "answered", answer: "yes", band: "comfortably above", answerHash,
    enclaveRequestId: "req-abc123", provider: "0xD179F4526064846dE9a9E9D93683AF75CB72E503",
    model: "glm-5.3", verification: "provider-address", teeType: "TDX/dstack", latencyMs: 5200,
  },
});
if (answered.status !== 200) { bad(`answer failed: ${answered.data.error}`); }
else ok(`answered, receipt ${answered.data.accessId}`);

/* ---------------------------------------------------- 9. the verifier ---- */
step(9, "The verifier reads the answer - and only the answer");
const polled = await api(`/api/request?id=${request.data.requestId}`);
if (polled.data.state !== "answered") bad(`state is ${polled.data.state}`);
else ok(`request is answered`);
if (!polled.data.receipt) bad("no receipt returned to the verifier");
else {
  ok(`receipt says ${String(polled.data.receipt.answer).toUpperCase()} · ${polled.data.receipt.band}`);
  const leaked = ["cipher", "iv", "plaintext", "passphrase", "sha256"].filter((k) => k in polled.data.receipt);
  if (leaked.length) bad(`the receipt leaked ${leaked.join(", ")} to the verifier`);
  else ok("the receipt carries no ciphertext, no key material and no document");
}

/* --------------------------------------------------- 10. no replay ------- */
step(10, "The same request cannot be answered twice");
const replay = await api("/api/answer", {
  body: {
    requestId: request.data.requestId, owner: OWNER.address, ownerSig: realAnswerSig,
    decision: "answered", answer: "no", answerHash, enclaveRequestId: "req-abc123",
  },
});
if (replay.status === 200) bad("a decided request was answered again");
else ok(`replay refused (${replay.status}): ${String(replay.data.error).slice(0, 50)}…`);

console.log(
  fails
    ? `\n${fails} check(s) FAILED.\n`
    : `\nTWO-PARTY GREEN — two wallets, neither of them the server.\n` +
      `The operator paid for every write and could not author one.\n`,
);
process.exit(fails ? 1 : 0);
