/**
 * AskOnly — one wallet popup a week, and no question count.
 *
 *   npm run prove:session          (the app running: npm start)
 *
 * A browser asks its wallet once for a Session, naming a key it generated, and that
 * key signs everything after: sealing, adding a reviewer, asking, answering, ending,
 * deleting. This proves the server takes that and nothing looser:
 *   - a session that expired, runs too long, says a different date than it holds,
 *     or was signed by someone else, is refused before any gas is spent
 *   - an action signed by any key but the one the session names is refused
 *   - the records keep both signatures, and the browser's own checks
 *     (web/src/lib/askonly.js) trace them back to the wallet, and fail on a tamper
 *   - sealing is signed, and the hash is of the bytes actually sent
 *   - a new grant has no count; the brake is 10 questions waiting at once
 *
 * Spends Arkiv gas on about fifteen writes.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import {
  domain, SessionTypes, sessionMessage, GrantTypes, grantMessage, RequestTypes, requestMessage,
  AnswerTypes, answerMessage, RevokeTypes, revokeMessage, ForgetTypes, forgetMessage, SESSION_DAYS,
} from "../src/auth/typed.mjs";
import { sealedBody } from "./seal.mjs";
import { signedByOwner, signedByAsker } from "../web/src/lib/askonly.js";

const BASE = process.env.ASKONLY_URL || "http://localhost:5173";
let fails = 0;
const check = (cond, what, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!cond) fails += 1;
};
const step = (n, t) => console.log(`\n${n}. ${t}`);
const api = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};
const sha = async (t) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");
// A byte inside r. Not the last byte: that is v, and viem reads 00 the same as 1b.
const flip = (hex) => hex.slice(0, 20) + (hex[20] === "a" ? "b" : "a") + hex.slice(21);

const OWNER = privateKeyToAccount(generatePrivateKey());
const ASKER = privateKeyToAccount(generatePrivateKey());
const STRANGER = privateKeyToAccount(generatePrivateKey());
const OWNER_KEY = privateKeyToAccount(generatePrivateKey()); // the owner's browser
const ASKER_KEY = privateKeyToAccount(generatePrivateKey()); // the reviewer's browser

const week = () => Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
const signIn = async (wallet, key, diesAt = week(), message = null) => ({
  sessionKey: key.address,
  diesAt,
  sig: await wallet.signTypedData({
    domain, types: SessionTypes, primaryType: "Session",
    message: message ?? sessionMessage({ sessionKey: key.address, diesAt }),
  }),
});
const ownerSession = await signIn(OWNER, OWNER_KEY);
const askerSession = await signIn(ASKER, ASKER_KEY);

console.log(`AskOnly — sessions, against ${BASE}
  owner   ${OWNER.address}, signing in ${OWNER_KEY.address}
  asker   ${ASKER.address}, signing in ${ASKER_KEY.address}`);

/* --------------------------------------------------------------- 1 ------ */
step(1, "A session that should not count is refused, before any gas");
const revokeBy = async (key, session) => api("/api/grant/revoke", {
  grantId: "g-nothing", owner: OWNER.address, session,
  ownerSig: await key.signTypedData({ domain, types: RevokeTypes, primaryType: "Revoke", message: revokeMessage({ grantId: "g-nothing" }) }),
});
{
  let r = await revokeBy(OWNER_KEY, await signIn(OWNER, OWNER_KEY, Math.floor(Date.now() / 1000) - 60));
  check(r.status === 401 && r.data.code === "session-expired", "an expired session", `${r.status} ${r.data.code}`);

  r = await revokeBy(OWNER_KEY, await signIn(OWNER, OWNER_KEY, Math.floor(Date.now() / 1000) + 30 * 86_400));
  check(r.status === 401 && r.data.code === "session-invalid", "a session for a month", `${r.status} ${r.data.code}`);

  // The wallet was shown one date and the session holds another.
  const d = week();
  const lying = await signIn(OWNER, OWNER_KEY, d, { ...sessionMessage({ sessionKey: OWNER_KEY.address, diesAt: d }), expires: "1 Jan 2027, 00:00 UTC" });
  r = await revokeBy(OWNER_KEY, lying);
  check(r.status === 401 && r.data.code === "session-invalid", "a session whose date says something else", `${r.status} ${r.data.code}`);

  r = await revokeBy(OWNER_KEY, await signIn(STRANGER, OWNER_KEY));
  check(r.status === 401 && r.data.code === "session-invalid", "a session a stranger signed for the owner", `${r.status} ${r.data.code}`);

  r = await revokeBy(STRANGER, ownerSession);
  check(r.status === 401, "an action signed by a key the session does not name", `${r.status}`);

  r = await revokeBy(OWNER_KEY, ownerSession);
  check(r.status === 404, "the real session passes the signature check (and the grant does not exist)", `${r.status}`);
}

/* --------------------------------------------------------------- 2 ------ */
step(2, "Sealing is signed, by the session, over the bytes actually sent");
let vaultId;
{
  const body = await sealedBody(OWNER_KEY, { label: "Session test" });
  let r = await api("/api/vault", { ...body, owner: OWNER.address, ownerSig: undefined });
  check(r.status === 401, "an unsigned seal", `${r.status}`);

  r = await api("/api/vault", { ...body, owner: OWNER.address, sha256: "00".repeat(32), session: ownerSession });
  check(r.status === 400, "a seal whose hash is not of the bytes sent", `${r.status}`);

  r = await api("/api/vault", { ...body, owner: STRANGER.address, session: ownerSession });
  check(r.status === 401, "the owner's session claiming to seal for someone else", `${r.status}`);

  r = await api("/api/vault", { ...body, owner: OWNER.address, session: ownerSession });
  check(r.status === 200, "sealed by the browser key, no wallet popup", `${r.status} ${r.data.error ?? r.data.vaultId}`);
  vaultId = r.data.vaultId;
  if (!vaultId) process.exit(1);
}

/* --------------------------------------------------------------- 3 ------ */
step(3, "A reviewer is added by the session, with no question count");
let grant;
{
  const terms = {
    vaultId, verifier: ASKER.address, questionSet: "general", question: "whether I can afford the rent",
    diesAt: Date.now() + 10 * 60_000,
  };
  const ownerSig = await OWNER_KEY.signTypedData({ domain, types: GrantTypes, primaryType: "Grant", message: grantMessage(terms) });
  const r = await api("/api/grant", { ...terms, owner: OWNER.address, verifierName: "Landlord", ownerSig, session: ownerSession });
  check(r.status === 200, "issued", `${r.status} ${r.data.error ?? r.data.grantId}`);
  if (r.status !== 200) process.exit(1);

  const { data } = await api(`/api/grants?owner=${OWNER.address}`);
  grant = data.grants.find((g) => g.grantId === r.data.grantId);
  check(grant?.usesAllowed === 0, "the record carries no count", `usesAllowed=${grant?.usesAllowed}`);
  check(grant?.ownerKey?.toLowerCase() === OWNER_KEY.address.toLowerCase() && grant.ownerKeySig?.startsWith("0x"),
    "the record keeps the key and the wallet's session over it");
  check(await signedByOwner(grant, OWNER.address), "the owner's browser traces it back to the wallet");
  check(!(await signedByOwner({ ...grant, ownerKeySig: flip(grant.ownerKeySig) }, OWNER.address)), "and not with the session tampered");
  check(!(await signedByOwner({ ...grant, note: "anything at all" }, OWNER.address)), "and not with the scope widened");
  check(!(await signedByOwner(grant, STRANGER.address)), "and not as anyone else's");
}

/* --------------------------------------------------------------- 4 ------ */
step(4, "The reviewer asks through their session: no count, and a brake at 10 waiting");
const ask = async (question, session = askerSession, key = ASKER_KEY) => {
  const questionHash = await sha(question);
  const askedAt = Date.now();
  const askerSig = await key.signTypedData({
    domain, types: RequestTypes, primaryType: "Request", message: requestMessage({ grantId: grant.grantId, questionHash, askedAt }),
  });
  return api("/api/request", { grantId: grant.grantId, question, questionHash, askedAt, asker: ASKER.address, askerSig, session });
};
{
  const stolen = await ask("Is the rent covered? (owner's key)", ownerSession, OWNER_KEY);
  check(stolen.status === 401 || stolen.status === 403, "the owner's session cannot ask as the reviewer", `${stolen.status}`);

  let accepted = 0;
  let firstRefusal = null;
  for (let i = 1; i <= 11; i += 1) {
    const r = await ask(`Is monthly income above ${i * 1000}?`);
    if (r.status === 200) accepted += 1;
    else if (!firstRefusal) firstRefusal = { i, ...r };
  }
  check(accepted === 10, "10 questions in, more than any old count allowed", `${accepted} accepted`);
  check(firstRefusal?.i === 11 && firstRefusal.status === 429 && firstRefusal.data.retryAfterMs > 0,
    "the 11th waits: 429 with a time to try again", `${firstRefusal?.status} "${firstRefusal?.data?.error}"`);

  const { data } = await api(`/api/inbox?owner=${OWNER.address}`);
  const mine = data.pending.filter((p) => p.grantId === grant.grantId);
  check(mine.length === 10 && mine.every((p) => p.askKeyDiesAt === askerSession.diesAt), "each question keeps the reviewer's session", `${mine.length}`);
  check(await signedByAsker(mine[0], grant), "the owner's browser traces a question back to the reviewer's wallet");
  check(!(await signedByAsker({ ...mine[0], askKeySig: flip(mine[0].askKeySig) }, grant)), "and not with the session tampered");
  check(!(await signedByAsker({ ...mine[0], askKeyDiesAt: mine[0].askKeyDiesAt + 3600 }, grant)), "and not with the session's end moved");
}

/* --------------------------------------------------------------- 5 ------ */
step(5, "The owner's session answers, with no Delegation popup");
{
  const { data } = await api(`/api/inbox?owner=${OWNER.address}`);
  const q = data.pending.find((p) => p.grantId === grant.grantId);
  const answer = "yes";
  const band = "";
  const answerHash = await sha(JSON.stringify({ answer, band }));
  const signAnswer = (key) => key.signTypedData({
    domain, types: AnswerTypes, primaryType: "Answer",
    message: answerMessage({ requestId: q.requestId, grantId: grant.grantId, questionHash: q.questionHash, answerHash, enclaveRequestId: "" }),
  });
  const body = {
    requestId: q.requestId, decision: "answered", answer, band, answerHash, enclaveRequestId: "",
    verification: "no-lines-matched", linesSeen: "0/1",
  };
  let r = await api("/api/answer", { ...body, signer: ASKER_KEY.address, ownerSig: await signAnswer(ASKER_KEY), session: askerSession });
  check(r.status === 401 || r.status === 403, "the reviewer's session cannot answer", `${r.status}`);

  r = await api("/api/answer", { ...body, signer: OWNER_KEY.address, ownerSig: await signAnswer(OWNER_KEY), session: ownerSession });
  check(r.status === 200 && r.data.state === "answered", "answered by the owner's browser key", `${r.status} ${r.data.error ?? r.data.state}`);

  const p = await api("/api/presence", { vaultId, owner: OWNER.address, session: ownerSession });
  check(p.status === 200 && p.data.answering === true, "and it can say it is answering", `${p.status}`);
  const g = await api(`/api/grant?id=${grant.grantId}`);
  check(g.data.answering === true, "the reviewer sees it answering", `usesSpent=${g.data.usesSpent}`);
}

/* --------------------------------------------------------------- 6 ------ */
step(6, "Ending and deleting go through the session too");
{
  const ownerSig = await OWNER_KEY.signTypedData({ domain, types: RevokeTypes, primaryType: "Revoke", message: revokeMessage({ grantId: grant.grantId }) });
  let r = await api("/api/grant/revoke", { grantId: grant.grantId, owner: OWNER.address, ownerSig, session: ownerSession });
  check(r.status === 200, "ended", `${r.status} ${r.data.error ?? ""}`);
  r = await ask("Anything more?");
  check(r.status === 403, "and nothing more can be asked", `${r.status}`);

  const forgetSig = await OWNER_KEY.signTypedData({ domain, types: ForgetTypes, primaryType: "Forget", message: forgetMessage({ vaultId }) });
  r = await api("/api/vault/forget", { vaultId, owner: OWNER.address, ownerSig: forgetSig, session: ownerSession });
  check(r.status === 200, "deleted", `${r.status} ${r.data.error ?? ""}`);
}

console.log(fails ? `\nSESSIONS RED — ${fails} check(s) failed.` : "\nSESSIONS GREEN — one popup a week, every record still traces to a wallet, and no count.");
process.exit(fails ? 1 : 0);
