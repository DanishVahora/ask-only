/**
 * AskOnly — the owner's browser does not take the server's word for anything.
 *
 *   ASKONLY_URL=http://localhost:5174 node web/scripts/verify-check.mjs
 *
 * Runs the browser's own checks (web/src/lib/askonly.js) against records the real
 * server wrote, so a difference in how a value is stored and read back (an address's
 * case, a number, a hex string) shows up here and not as "Its terms don't match what
 * you signed" on someone's screen. Then it tampers with each thing the server could
 * lie about, and every check has to fail.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { DOMAIN, TYPES, STATEMENTS, signedByOwner, signedByAsker, sha256hex } from "../src/lib/askonly.js";

const BASE = process.env.ASKONLY_URL || "http://localhost:5173";
let fails = 0;
const check = (cond, m) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${m}`);
  if (!cond) fails += 1;
};
const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error}`);
  return data;
};
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const OWNER = privateKeyToAccount(generatePrivateKey());
const ASKER = privateKeyToAccount(generatePrivateKey());
const ANSWERING = privateKeyToAccount(generatePrivateKey()); // the key the owner's browser would name
const ASKKEY = privateKeyToAccount(generatePrivateKey()); // the key the reviewer's browser would hold

const { vaultId } = await api("/api/vault", {
  owner: OWNER.address, label: "Verify", docKind: "document", sha256: "",
  iv: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
  cipher: `0x${hex(crypto.getRandomValues(new Uint8Array(256)))}`, days: 30,
});

// Exactly what IssueSheet signs and sends.
const terms = {
  vaultId, verifier: ASKER.address, questionSet: "general", question: "whether I can afford the rent",
  usesAllowed: 100n, diesAt: BigInt(Date.now() + 10 * 60_000), sessionKey: ANSWERING.address, statement: STATEMENTS.grant,
};
const ownerSig = await OWNER.signTypedData({ domain: DOMAIN, types: { Grant: TYPES.Grant }, primaryType: "Grant", message: terms });
const { grantId } = await api("/api/grant", {
  vaultId, owner: OWNER.address, verifier: ASKER.address, verifierName: "Landlord", questionSet: "general",
  question: terms.question, usesAllowed: 100, diesAt: Number(terms.diesAt), sessionKey: ANSWERING.address,
  threshold: "", ownerSig, minutes: 10, days: null,
});

/** Exactly what the Composer signs and sends, by the wallet or by an ask key. */
const ask = async (question, viaKey) => {
  const questionHash = await sha256hex(question);
  const askedAt = Date.now();
  const message = { grantId, questionHash, askedAt: BigInt(askedAt), statement: STATEMENTS.request };
  const signer = viaKey ? ASKKEY : ASKER;
  const askerSig = await signer.signTypedData({ domain: DOMAIN, types: { Request: TYPES.Request }, primaryType: "Request", message });
  const extra = viaKey
    ? {
        askerKey: ASKKEY.address,
        askKeySig: await ASKER.signTypedData({
          domain: DOMAIN, types: { AskKey: TYPES.AskKey }, primaryType: "AskKey",
          message: { grantId, sessionKey: ASKKEY.address, diesAt: terms.diesAt, statement: STATEMENTS.askKey },
        }),
      }
    : {};
  return api("/api/request", { grantId, question, questionHash, askedAt, asker: ASKER.address, askerSig, ...extra });
};
const byWallet = await ask("Can they afford rent of 25,000?", false);
const byKey = await ask("Is the income steady?", true);

// What the owner's browser gets, read back from the chain through the real server.
const grant = (await api(`/api/grants?owner=${OWNER.address}`)).grants.find((g) => g.grantId === grantId);
const inbox = (await api(`/api/inbox?owner=${OWNER.address}`)).pending;
const r1 = inbox.find((r) => r.requestId === byWallet.requestId);
const r2 = inbox.find((r) => r.requestId === byKey.requestId);

console.log("\nThe real records check out");
check(await signedByOwner(grant, OWNER.address), "the owner's signature over the permission, as stored");
check(await signedByAsker(r1, grant), "a question signed by the reviewer's wallet");
check(await signedByAsker(r2, grant), "a question signed by a key the reviewer's wallet approved");

console.log("\nAnything the server could change, it cannot");
check(!(await signedByOwner({ ...grant, note: "anything in this document" }, OWNER.address)), "a widened topic is caught");
check(!(await signedByOwner({ ...grant, verifier: OWNER.address }, OWNER.address)), "a different reviewer is caught");
check(!(await signedByOwner({ ...grant, diesAt: grant.diesAt + 86_400_000 }, OWNER.address)), "a longer life is caught");
check(!(await signedByOwner({ ...grant, sessionKey: ASKKEY.address }, OWNER.address)), "a different answering key is caught");
check(!(await signedByOwner(grant, ASKER.address)), "a permission someone else signed is caught");
check(!(await signedByAsker({ ...r1, question: "What is their PAN?" }, grant)), "a question swapped for another is caught");
const otherHash = await sha256hex("What is their PAN?");
check(!(await signedByAsker({ ...r1, question: "What is their PAN?", questionHash: otherHash }, grant)), "and so is one with its hash swapped too");
check(!(await signedByAsker({ ...r2, askKeySig: r1.askerSig }, grant)), "a key nobody approved is caught");
check(!(await signedByAsker(r2, { ...grant, grantId: "g-000000000000" })), "a key approved for another permission is caught");

console.log(fails ? `\n${fails} FAILED` : "\nVERIFY GREEN — the owner's browser checks the server, and catches every change.");
process.exit(fails ? 1 : 0);
