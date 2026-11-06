/**
 * AskOnly — prove the rules of asking.
 *
 *   node --env-file=.env scripts/asking-prove.mjs
 *
 * A permission is worth several questions, and the person asking should not have
 * to wait for one answer before sending the next. That only works if the limits
 * hold with several open at once, and if a permission that has ended really has:
 *
 *   - several questions can be open at the same time, and all come back
 *   - the limit counts questions still waiting, so it cannot be overrun
 *   - a question that was turned down counts too
 *   - a question that will not fit, or does not match its signature, is refused
 *     rather than quietly cut short
 *   - an answer with no enclave behind it can still be recorded
 *   - ending a permission needs the owner's signature, and takes effect at once:
 *     no new questions, nothing left waiting, nothing answerable
 *   - an expired permission behaves the same way
 *   - deleting a document ends the permissions that point at it
 *   - "they are answering right now" can only be claimed by the owner
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  GrantTypes, RequestTypes, AnswerTypes, DelegationTypes, ForgetTypes, RevokeTypes, PresenceTypes,
  grantMessage, requestMessage, answerMessage, delegationMessage, forgetMessage, revokeMessage, presenceMessage,
  domain,
} from "../src/auth/typed.mjs";

const BASE = process.env.ASKONLY_URL || "http://localhost:5173";

let fails = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { fails += 1; console.log(`  FAIL  ${m}`); };
const check = (cond, m, why = "") => (cond ? ok(m) : bad(why ? `${m} -> ${why}` : m));
const step = (n, t) => console.log(`\n[${n}] ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const OWNER = privateKeyToAccount(generatePrivateKey());
const ASKER = privateKeyToAccount(generatePrivateKey());
const STRANGER = privateKeyToAccount(generatePrivateKey());
const SESSION = privateKeyToAccount(generatePrivateKey());

console.log(`AskOnly — the rules of asking
  owner     ${OWNER.address}
  asker     ${ASKER.address}
  stranger  ${STRANGER.address}`);

const seal = async (label) => {
  const r = await api("/api/vault", {
    owner: OWNER.address, label, docKind: "document", sha256: await sha(label),
    iv: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
    cipher: `0x${hex(crypto.getRandomValues(new Uint8Array(256)))}`, days: 30,
  });
  if (r.status !== 200) { bad(`seal failed: ${JSON.stringify(r.data)}`); process.exit(1); }
  return r.data.vaultId;
};

const issue = async (vaultId, { uses, minutes, scope = "whether I earn enough to cover the rent", sessionKey }) => {
  const terms = {
    vaultId, verifier: ASKER.address, questionSet: "income", question: scope,
    usesAllowed: uses, diesAt: Date.now() + minutes * 60_000, sessionKey,
  };
  const ownerSig = await OWNER.signTypedData({
    domain, types: { Grant: GrantTypes.Grant }, primaryType: "Grant", message: grantMessage(terms),
  });
  const r = await api("/api/grant", { ...terms, owner: OWNER.address, verifierName: "Landlord", ownerSig, minutes });
  if (r.status !== 200) { bad(`grant failed: ${JSON.stringify(r.data)}`); process.exit(1); }
  return r.data.grantId;
};

const ask = async (grantId, question, tamper = {}) => {
  const questionHash = tamper.hash ?? (await sha(question));
  const askedAt = Date.now();
  const askerSig = await ASKER.signTypedData({
    domain, types: { Request: RequestTypes.Request }, primaryType: "Request",
    message: requestMessage({ grantId, questionHash, askedAt }),
  });
  return api("/api/request", { grantId, question, questionHash, askedAt, asker: ASKER.address, askerSig });
};

const thread = async (grantId) => (await api(`/api/requests?grant=${grantId}`)).data.requests ?? [];
const inbox = async () => (await api(`/api/inbox?owner=${OWNER.address}`)).data.pending ?? [];

/** Answer as the owner's wallet, or decline when `refuse` says why. */
const answer = async (grantId, r, { refuse } = {}) => {
  const answerHash = refuse ? "" : await sha(JSON.stringify({ answer: "yes", band: "" }));
  const enclaveRequestId = refuse ? "" : "req-test";
  const ownerSig = await OWNER.signTypedData({
    domain, types: { Answer: AnswerTypes.Answer }, primaryType: "Answer",
    message: answerMessage({ requestId: r.requestId, grantId, questionHash: r.questionHash, answerHash, enclaveRequestId }),
  });
  return api("/api/answer", {
    requestId: r.requestId, owner: OWNER.address, ownerSig, answerHash, enclaveRequestId,
    decision: refuse ? "refused" : "answered",
    ...(refuse
      ? { reason: refuse }
      // provider is "" on purpose: that is what the browser sends when it has none,
      // and addr("") used to throw after the enclave had already been asked.
      : { answer: "yes", band: "", provider: "", model: "", verification: "no-lines-matched", linesSeen: "3/17", latencyMs: 12 }),
  });
};

/* ------------------------------------------------------- several at once -- */
const vaultId = await seal("The letter");
const grantId = await issue(vaultId, { uses: 3, minutes: 10 });

step(1, "Three questions open at the same time, with nothing answered yet");
for (const q of ["Can they afford rent of 25,000?", "Are they still employed?", "Is it a permanent role?"]) {
  const r = await ask(grantId, q);
  check(r.status === 200, `asked "${q}"`, JSON.stringify(r.data));
}
let t = await thread(grantId);
check(t.length === 3 && t.every((r) => r.state === "pending"), "all three come back, all waiting", `${t.length} rows`);

step(2, "The limit counts what is still waiting");
{
  const r = await ask(grantId, "A fourth question?");
  check(r.status === 403, `a fourth is refused (${r.status}): ${String(r.data.error).slice(0, 50)}`);
}

step(3, "They reach the owner, carrying the owner's own words for what was allowed");
{
  const p = await inbox();
  check(p.length === 3, "three are waiting", `${p.length}`);
  check(p.every((r) => r.scope === "whether I earn enough to cover the rent"), "each carries the scope", JSON.stringify(p[0]?.scope));
}

step(4, "A question that will not fit, or does not match what was signed");
{
  const long = await ask(grantId, "x".repeat(200));
  check(long.status === 400, `too long is refused, not cut short (${long.status})`);
  const swapped = await ask(grantId, "A different question", { hash: await sha("the one I signed") });
  check(swapped.status === 400, `a question that is not the one signed is refused (${swapped.status})`);
}

/* ------------------------------------------------------------ resolving -- */
step(5, "An answer with no enclave behind it still records, and names who asked");
{
  t = await thread(grantId);
  const first = t[t.length - 1];
  const r = await answer(grantId, first);
  check(r.status === 200, "recorded with a blank provider", JSON.stringify(r.data));
  t = await thread(grantId);
  const done = t.find((x) => x.requestId === first.requestId);
  check(done?.state === "answered", "its state is answered", done?.state);
  check(done?.receipt?.answer === "yes", "the receipt came back with it");
  check(done?.receipt?.linesSeen === "3/17", "the receipt says how much the enclave saw", String(done?.receipt?.linesSeen));
  const led = (await api(`/api/accesses?owner=${OWNER.address}`)).data.accesses ?? [];
  check(led[0]?.askerName === "Landlord", "the ledger has the name, not just an address", JSON.stringify(led[0]?.askerName));
}

step(6, "Turning one down, from a delegated key, because it was out of scope");
{
  t = await thread(grantId);
  const victim = t.find((x) => x.state === "pending");
  const diesAt = Math.floor(Date.now() / 1000) + 600;
  const sig = await OWNER.signTypedData({
    domain, types: { Delegation: DelegationTypes.Delegation }, primaryType: "Delegation",
    message: delegationMessage({ vaultId, sessionKey: SESSION.address, diesAt }),
  });
  const ownerSig = await SESSION.signTypedData({
    domain, types: { Answer: AnswerTypes.Answer }, primaryType: "Answer",
    message: answerMessage({ requestId: victim.requestId, grantId, questionHash: victim.questionHash, answerHash: "", enclaveRequestId: "" }),
  });
  const r = await api("/api/answer", {
    requestId: victim.requestId, owner: OWNER.address, signer: SESSION.address, ownerSig,
    decision: "refused", reason: "out-of-scope", answerHash: "", enclaveRequestId: "",
    delegation: { owner: OWNER.address, vaultId, sessionKey: SESSION.address, diesAt, sig },
  });
  check(r.status === 200, "turned down", JSON.stringify(r.data));
  t = await thread(grantId);
  const done = t.find((x) => x.requestId === victim.requestId);
  check(done?.state === "refused", "its state is refused");
  check(done?.refusal?.reason === "out-of-scope", "the asker can see why", String(done?.refusal?.reason));
  const g = (await api(`/api/grant?id=${grantId}`)).data;
  check(g.usesSpent === 2, "both count against the limit", `usesSpent=${g.usesSpent}`);
  const more = await ask(grantId, "Room for another?");
  check(more.status === 403, `2 used + 1 waiting = the limit of 3, so no more (${more.status})`);

  step(7, "Only the owner can claim to be answering right now");
  const p1 = await api("/api/presence", { delegation: { owner: OWNER.address, vaultId, sessionKey: SESSION.address, diesAt, sig } });
  check(p1.status === 200 && p1.data.answering === true, "the owner's live delegation counts", JSON.stringify(p1.data));
  check((await api(`/api/grant?id=${grantId}`)).data.answering === true, "the asker's page can see it");
  const forged = await STRANGER.signTypedData({
    domain, types: { Delegation: DelegationTypes.Delegation }, primaryType: "Delegation",
    message: delegationMessage({ vaultId, sessionKey: SESSION.address, diesAt }),
  });
  const p2 = await api("/api/presence", { delegation: { owner: STRANGER.address, vaultId, sessionKey: SESSION.address, diesAt, sig: forged } });
  check(p2.status === 403, `a stranger's delegation is refused (${p2.status})`);
  const p3 = await api("/api/presence", { stop: true, delegation: { owner: OWNER.address, vaultId, sessionKey: SESSION.address, diesAt, sig } });
  check(p3.data.answering === false, "stopping clears it at once");
}

/* -------------------------------------------------------- ending things -- */
step(8, "Ending a permission needs the owner's signature");
{
  const unsigned = await api("/api/grant/revoke", { grantId, owner: OWNER.address });
  check(unsigned.status === 401, `unsigned is refused (${unsigned.status})`);
  const sig = await STRANGER.signTypedData({
    domain, types: { Revoke: RevokeTypes.Revoke }, primaryType: "Revoke", message: revokeMessage({ grantId }),
  });
  const stranger = await api("/api/grant/revoke", { grantId, owner: STRANGER.address, ownerSig: sig });
  check(stranger.status === 403, `a stranger is refused (${stranger.status})`);
  check((await api(`/api/grant?id=${grantId}`)).data.state === "live", "and it is still live");
}

step(9, "When the owner ends it, it is over at once");
{
  const before = (await thread(grantId)).find((x) => x.state === "pending");
  check(Boolean(before), "one question is still waiting");
  const ownerSig = await OWNER.signTypedData({
    domain, types: { Revoke: RevokeTypes.Revoke }, primaryType: "Revoke", message: revokeMessage({ grantId }),
  });
  const r = await api("/api/grant/revoke", { grantId, owner: OWNER.address, ownerSig });
  check(r.status === 200, "ended", JSON.stringify(r.data));
  const again = await ask(grantId, "Can I still ask?");
  check(again.status === 403, `no new questions (${again.status}): ${String(again.data.error).slice(0, 40)}`);
  check(!(await inbox()).some((x) => x.grantId === grantId), "nothing is left waiting on the owner");
  const late = await answer(grantId, before);
  check(late.status === 410, `the question left over cannot be answered (${late.status})`);
}

step(10, "Deleting a document ends the permissions that point at it");
{
  const doc = await seal("Going away");
  const g = await issue(doc, { uses: 2, minutes: 10 });
  const ownerSig = await OWNER.signTypedData({
    domain, types: { Forget: ForgetTypes.Forget }, primaryType: "Forget", message: forgetMessage({ vaultId: doc }),
  });
  const r = await api("/api/vault/forget", { vaultId: doc, owner: OWNER.address, ownerSig });
  check(r.status === 200 && r.data.endedPermissions === 1, "deleted, and one permission ended with it", JSON.stringify(r.data));
  const ask2 = await ask(g, "Anything left?");
  check(ask2.status === 403, `asking is refused (${ask2.status})`);
}

step(11, "The person asking can find what they have been given");
{
  const mine = (await api(`/api/grants?verifier=${ASKER.address}`)).data.grants ?? [];
  check(mine.length >= 2 && mine.every((g) => g.verifier === ASKER.address), `${mine.length} permissions, all theirs`);
  check(Boolean(mine[0]?.note), "each says what it is about");
}

step(12, "One signature is enough: the key the owner named in the permission can answer");
{
  const doc = await seal("Named key");
  const NAMED = privateKeyToAccount(generatePrivateKey());
  const g = await issue(doc, { uses: 3, minutes: 10, sessionKey: NAMED.address });
  const stored = (await api(`/api/grant?id=${g}`)).data;
  check(stored.sessionKey === NAMED.address, "the permission records which key may answer", String(stored.sessionKey));

  const q1 = await ask(g, "Answered by the named key?");
  check(q1.status === 200, "asked");
  const pending = (await thread(g))[0];
  const answerHash = await sha(JSON.stringify({ answer: "yes", band: "" }));
  const sign = (account) => account.signTypedData({
    domain, types: { Answer: AnswerTypes.Answer }, primaryType: "Answer",
    message: answerMessage({ requestId: pending.requestId, grantId: g, questionHash: pending.questionHash, answerHash, enclaveRequestId: "r" }),
  });
  const body = (signer, ownerSig) => ({
    requestId: pending.requestId, owner: OWNER.address, signer: signer.address, ownerSig, answerHash, enclaveRequestId: "r",
    decision: "answered", answer: "yes", band: "", provider: "", model: "", verification: "no-lines-matched", linesSeen: "1/1", latencyMs: 1,
  });
  const other = privateKeyToAccount(generatePrivateKey());
  const wrong = await api("/api/answer", body(other, await sign(other)));
  check(wrong.status === 403, `a key the permission does not name is refused (${wrong.status})`);
  const right = await api("/api/answer", body(NAMED, await sign(NAMED)));
  check(right.status === 200, "the named key can answer, with no delegation and no wallet", JSON.stringify(right.data));
  const led = (await api(`/api/accesses?owner=${OWNER.address}`)).data.accesses ?? [];
  check(led.some((a) => a.grantId === g), "the answer is recorded against the owner");

  const at = Date.now();
  const sig = await NAMED.signTypedData({
    domain, types: { Presence: PresenceTypes.Presence }, primaryType: "Presence", message: presenceMessage({ grantId: g, at }),
  });
  const seen = await api("/api/presence", { grantId: g, at, sessionKey: NAMED.address, sig });
  check(seen.data.answering === true, "the named key can say it is answering", JSON.stringify(seen.data));
  const fake = await other.signTypedData({
    domain, types: { Presence: PresenceTypes.Presence }, primaryType: "Presence", message: presenceMessage({ grantId: g, at }),
  });
  const faked = await api("/api/presence", { grantId: g, at, sessionKey: other.address, sig: fake });
  check(faked.status === 403, `any other key cannot (${faked.status})`);
}

step(13, "An expired permission behaves the same way (waits out one minute)");
{
  const doc = await seal("Short-lived");
  const g = await issue(doc, { uses: 3, minutes: 1 });
  const q = await ask(g, "Quick, is this still alive?");
  check(q.status === 200, "asked while it was alive", JSON.stringify(q.data));
  check((await inbox()).some((x) => x.grantId === g), "it reaches the owner");
  const pending = (await thread(g))[0];
  await sleep(70_000);
  check(!(await inbox()).some((x) => x.grantId === g), "once expired, nothing is left waiting on the owner");
  const late = await answer(g, pending);
  check(late.status === 410, `and it cannot be answered (${late.status}): ${String(late.data.error).slice(0, 40)}`);
  const left = await thread(g);
  check(left.length === 1, "the asker can still see what they asked");
}

console.log(
  fails === 0
    ? "\nASKING GREEN — several questions at once, a limit that holds, and an end that is an end."
    : `\n${fails} FAILED`,
);
process.exit(fails === 0 ? 0 : 1);
