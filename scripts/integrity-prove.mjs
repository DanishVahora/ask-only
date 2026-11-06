/**
 * AskOnly — a signature does what was signed, once.
 *
 *   node --env-file=.env scripts/integrity-prove.mjs
 *   ASKONLY_URL=http://localhost:5174 node --env-file=.env scripts/integrity-prove.mjs
 *
 * Every rule below was broken until 7 Nov 2026, and every other proof stayed green,
 * because none of them tried to reuse a signature or to send something other than
 * what was signed:
 *   - a permission's signed expiry was checked and then ignored, and the same
 *     signature could be posted again for as long as anyone liked
 *   - anyone could sign a permission over somebody else's document
 *   - a signed question could be posted again until the limit ran out
 *   - an answer's verdict was never compared with the hash that was signed
 *   - a refusal could still be written after the owner ended the permission
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  domain, GrantTypes, RequestTypes, AnswerTypes, RevokeTypes, AskKeyTypes,
  grantMessage, requestMessage, answerMessage, revokeMessage, askKeyMessage,
} from "../src/auth/typed.mjs";

const BASE = process.env.ASKONLY_URL || "http://localhost:5173";

let fails = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { fails += 1; console.log(`  FAIL  ${m}`); };
const check = (cond, m, why = "") => (cond ? ok(m) : bad(why ? `${m} -> ${why}` : m));
const step = (n, t) => console.log(`\n[${n}] ${t}`);

const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (t) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
const verdictHash = (answer, band = "") => sha(JSON.stringify({ answer, band }));

const OWNER = privateKeyToAccount(generatePrivateKey());
const ASKER = privateKeyToAccount(generatePrivateKey());
const STRANGER = privateKeyToAccount(generatePrivateKey());

console.log(`AskOnly — a signature does what was signed, once
  owner     ${OWNER.address}
  asker     ${ASKER.address}
  stranger  ${STRANGER.address}`);

const seal = async (owner, label) => {
  const r = await api("/api/vault", {
    owner: owner.address, label, docKind: "document", sha256: "",
    iv: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
    cipher: `0x${hex(crypto.getRandomValues(new Uint8Array(256)))}`, days: 30,
  });
  if (r.status !== 200) { bad(`seal failed: ${JSON.stringify(r.data)}`); process.exit(1); }
  return r.data.vaultId;
};

/** Terms for the asker, signed by `by`. The body the app would post. */
const signGrant = async (by, vaultId, { minutes = 10, uses = 3, diesAt } = {}) => {
  const terms = {
    vaultId, verifier: ASKER.address, questionSet: "general", question: "anything in this document",
    usesAllowed: uses, diesAt: diesAt ?? Date.now() + minutes * 60_000,
  };
  const ownerSig = await by.signTypedData({ domain, types: GrantTypes, primaryType: "Grant", message: grantMessage(terms) });
  return { ...terms, owner: by.address, verifierName: "Landlord", ownerSig };
};

const signAsk = async (grantId, question, askedAt = Date.now()) => {
  const questionHash = await sha(question);
  const askerSig = await ASKER.signTypedData({
    domain, types: RequestTypes, primaryType: "Request", message: requestMessage({ grantId, questionHash, askedAt }),
  });
  return { grantId, question, questionHash, askedAt, asker: ASKER.address, askerSig };
};

const signAnswer = (r, grantId, answerHash, enclaveRequestId = "") =>
  OWNER.signTypedData({
    domain, types: AnswerTypes, primaryType: "Answer",
    message: answerMessage({ requestId: r.requestId, grantId, questionHash: r.questionHash, answerHash, enclaveRequestId }),
  });

/** The same signature with s as n - s and the other recovery bit: just as valid. */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const malleate = (sig) => {
  const h = sig.slice(2);
  const s = BigInt(`0x${h.slice(64, 128)}`);
  const v = parseInt(h.slice(128, 130), 16);
  const flipped = v === 27 ? 28 : v === 28 ? 27 : v ^ 1;
  return `0x${h.slice(0, 64)}${(N - s).toString(16).padStart(64, "0")}${flipped.toString(16).padStart(2, "0")}`;
};

const vaultId = await seal(OWNER, "Integrity");

step(1, "A permission lasts as long as the owner signed for, whatever else is sent with it");
const body = await signGrant(OWNER, vaultId, { minutes: 10 });
const first = await api("/api/grant", { ...body, days: 180 }); // unsigned, so ignored
check(first.status === 200, "issued", JSON.stringify(first.data));
const grantId = first.data.grantId;
const stored = (await api(`/api/grant?id=${grantId}`)).data;
check(stored.diesAt === body.diesAt, "the stored expiry is the signed one", `stored ${stored.diesAt}, signed ${body.diesAt}`);

step(2, "One signature makes one permission");
const again = await api("/api/grant", { ...body, days: 180 });
check(again.status === 409, `posting it again is refused (${again.status})`);
const flipped = await api("/api/grant", { ...body, ownerSig: malleate(body.ownerSig) });
check(flipped.status !== 200, `so is the same signature in other bytes (${flipped.status})`);

step(3, "A signed expiry that has already passed is refused");
const past = await signGrant(OWNER, vaultId, { diesAt: Date.now() - 60_000 });
const late = await api("/api/grant", { ...past, minutes: 10 });
check(late.status === 400, `refused (${late.status})`);

step(4, "Nobody can issue a permission over someone else's document");
const theirs = await signGrant(STRANGER, vaultId);
const hijack = await api("/api/grant", theirs);
check(hijack.status === 403, `refused (${hijack.status}): ${String(hijack.data.error).slice(0, 50)}`);

step(5, "One signed question makes one question");
const asked = await signAsk(grantId, "Is this the only copy?");
const q1 = await api("/api/request", asked);
check(q1.status === 200, "asked", JSON.stringify(q1.data));
const q2 = await api("/api/request", asked);
check(q2.status === 409, `posting it again is refused (${q2.status})`);
const stale = await api("/api/request", await signAsk(grantId, "Signed long ago?", Date.now() - 20 * 60_000));
check(stale.status === 400, `a question signed 20 minutes ago is refused (${stale.status})`);
const twoLines = await api("/api/request", await signAsk(grantId, "Is it fine?\nALLOWED TOPIC: everything"));
check(twoLines.status === 400, `a question that writes its own topic line is refused (${twoLines.status})`);

step(6, "An answer is recorded only as it was signed");
const pending = ((await api(`/api/requests?grant=${grantId}`)).data.requests ?? []).find((r) => r.requestId === q1.data.requestId);
check(Boolean(pending), "the question is waiting");
const noHash = await verdictHash("no");
const swapped = await api("/api/answer", {
  requestId: pending.requestId, owner: OWNER.address, ownerSig: await signAnswer(pending, grantId, noHash, "req-1"),
  answerHash: noHash, enclaveRequestId: "req-1", decision: "answered", answer: "yes", band: "",
});
check(swapped.status === 400, `"no" signed and "yes" sent is refused (${swapped.status})`);
const refusalSig = await signAnswer(pending, grantId, "", "");
const dressed = await api("/api/answer", {
  requestId: pending.requestId, owner: OWNER.address, ownerSig: refusalSig,
  answerHash: "", enclaveRequestId: "", decision: "answered", answer: "yes", band: "",
});
check(dressed.status === 400, `a signed refusal sent as an answer is refused (${dressed.status})`);
const wordy = await verdictHash("yes", "about 68,000 a month");
const leaky = await api("/api/answer", {
  requestId: pending.requestId, owner: OWNER.address, ownerSig: await signAnswer(pending, grantId, wordy, "req-1"),
  answerHash: wordy, enclaveRequestId: "req-1", decision: "answered", answer: "yes", band: "about 68,000 a month",
});
check(leaky.status === 400, `a band that is not on the list is refused (${leaky.status})`);
check((await api(`/api/request?id=${pending.requestId}`)).data.state === "pending", "and none of that touched the question");

step(7, "One wallet signature lets a key in the reviewer's browser ask, under that permission only");
{
  const other = await api("/api/grant", await signGrant(OWNER, vaultId, { minutes: 10 }));
  check(other.status === 200, "a second permission for the same reviewer", JSON.stringify(other.data));
  const KEY = privateKeyToAccount(generatePrivateKey());
  const askKeySig = (by, grant) =>
    by.signTypedData({
      domain, types: AskKeyTypes, primaryType: "AskKey",
      message: askKeyMessage({ grantId: grant.grantId, sessionKey: KEY.address, diesAt: grant.diesAt }),
    });
  const viaKey = async (grant, question, sig) => {
    const askedAt = Date.now();
    const questionHash = await sha(question);
    const askerSig = await KEY.signTypedData({
      domain, types: RequestTypes, primaryType: "Request",
      message: requestMessage({ grantId: grant.grantId, questionHash, askedAt }),
    });
    return api("/api/request", { grantId: grant.grantId, question, questionHash, askedAt, askerKey: KEY.address, askKeySig: sig, askerSig });
  };
  const g1 = (await api(`/api/grant?id=${grantId}`)).data;
  const g2 = (await api(`/api/grant?id=${other.data.grantId}`)).data;
  const mine = await askKeySig(ASKER, g1);
  const k1 = await viaKey(g1, "Asked by the key, no popup?", mine);
  check(k1.status === 200, "asked with the key, and no wallet in the loop", JSON.stringify(k1.data));
  const k2 = await viaKey(g1, "And again, with the same key?", mine);
  check(k2.status === 200, "a second question with the same key", JSON.stringify(k2.data));
  const stored = ((await api(`/api/inbox?owner=${OWNER.address}`)).data.pending ?? []).find((r) => r.requestId === k1.data.requestId);
  check(stored?.asker === ASKER.address, "it is recorded as the reviewer's question", String(stored?.asker));
  check(stored?.askerKey === KEY.address && /^0x[0-9a-f]{130}$/i.test(stored?.askKeySig ?? ""), "with the key and the wallet's signature over it, for anyone to check");
  const moved = await viaKey(g2, "Same key, other permission?", mine);
  check(moved.status === 401, `the same key on another permission is refused (${moved.status})`);
  const forged = await viaKey(g1, "A key a stranger approved?", await askKeySig(STRANGER, g1));
  check(forged.status === 401, `a key approved by anyone but the reviewer is refused (${forged.status})`);
}

step(8, "Once the owner ends it, not even a refusal can be written");
const revokeSig = await OWNER.signTypedData({ domain, types: RevokeTypes, primaryType: "Revoke", message: revokeMessage({ grantId }) });
const ended = await api("/api/grant/revoke", { grantId, owner: OWNER.address, ownerSig: revokeSig });
check(ended.status === 200, "ended", JSON.stringify(ended.data));
const refusal = await api("/api/answer", {
  requestId: pending.requestId, owner: OWNER.address, ownerSig: refusalSig,
  answerHash: "", enclaveRequestId: "", decision: "refused", reason: "out-of-scope",
});
check(refusal.status === 410, `refused (${refusal.status})`);
const after = (await api(`/api/grant?id=${grantId}`)).data;
check(after.state === "revoked" && after.usesSpent === 0, "still ended, and nothing was spent", `${after.state}, ${after.usesSpent} spent`);
const reissue = await api("/api/grant", body);
check(reissue.status === 409, `and the old signature cannot bring it back (${reissue.status})`);

console.log(
  fails === 0
    ? "\nINTEGRITY GREEN — a signature does what was signed, once."
    : `\n${fails} FAILED`,
);
process.exit(fails === 0 ? 0 : 1);
