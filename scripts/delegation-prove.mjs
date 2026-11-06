/**
 * AskOnly — prove that "on call" cannot be abused.
 *
 *   node --env-file=.env scripts/delegation-prove.mjs
 *
 * Being on call lets an ephemeral key, generated in the owner's tab, sign
 * answers so the person asking is not left waiting on a human to click. That
 * convenience is only acceptable if the delegation is genuinely narrow, so
 * this asserts the narrowness rather than claiming it:
 *
 *   - a delegation signed by someone who is not the owner is refused
 *   - a delegation naming a DIFFERENT key than the one that signed is refused
 *   - a delegation for a DIFFERENT document is refused
 *   - an EXPIRED delegation is refused
 *   - only the exact, live, correctly-scoped chain is accepted
 *
 * The server must never take any of these on trust; it has the owner's
 * signature over the delegation and can check every clause itself.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sealedBody } from "./seal.mjs";
import {
  GrantTypesV1 as GrantTypes, RequestTypes, AnswerTypes, DelegationTypes,
  grantMessage, requestMessage, answerMessage, delegationMessage, domain, STATEMENTS,
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const sha256hex = async (t) => {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const OWNER = privateKeyToAccount(generatePrivateKey());
const ASKER = privateKeyToAccount(generatePrivateKey());
const STRANGER = privateKeyToAccount(generatePrivateKey());
const SESSION = privateKeyToAccount(generatePrivateKey());
const OTHER_KEY = privateKeyToAccount(generatePrivateKey());

console.log(`AskOnly — delegated answering
  owner       ${OWNER.address}
  asker       ${ASKER.address}
  session key ${SESSION.address}`);

/* --------------------------------------------------------- setup -------- */
step(1, "Owner seals two documents and issues a permission on the first");

const sealOne = async (label) => {
  const r = await api("/api/vault", {
    body: await sealedBody(OWNER, { label, docKind: "resume", bytes: 512 }),
  });
  if (r.status !== 200) { bad(`seal failed: ${r.data.error}`); process.exit(1); }
  return r.data.vaultId;
};

const vaultId = await sealOne("Resume - delegation test");
const otherVaultId = await sealOne("Something else entirely");
ok(`two vaults: ${vaultId} and ${otherVaultId}`);

const diesAt = Date.now() + 10 * 60_000;
const terms = {
  vaultId,
  verifier: ASKER.address,
  questionSet: "general",
  question: "anything about where I studied",
  usesAllowed: 6,
  diesAt,
};
const grantSig = await OWNER.signTypedData({
  domain, types: { Grant: GrantTypes.Grant }, primaryType: "Grant",
  message: { ...grantMessage(terms), statement: STATEMENTS.grant },
});
const grant = await api("/api/grant", {
  body: { ...terms, owner: OWNER.address, ownerSig: grantSig, minutes: 10 },
});
if (grant.status !== 200) { bad(`grant failed: ${grant.data.error}`); process.exit(1); }
const grantId = grant.data.grantId;
ok(`permission ${grantId} issued to the asker`);

/* Open a fresh request we can try to answer, once per attempt. */
let n = 0;
const openRequest = async () => {
  n += 1;
  const question = `Did they study at Dharmsinh Desai University? (${n})`;
  const questionHash = await sha256hex(question);
  const askedAt = Date.now();
  const sig = await ASKER.signTypedData({
    domain, types: { Request: RequestTypes.Request }, primaryType: "Request",
    message: { ...requestMessage({ grantId, questionHash, askedAt }), statement: STATEMENTS.request },
  });
  const r = await api("/api/request", {
    body: { grantId, question, questionHash, askedAt, asker: ASKER.address, askerSig: sig },
  });
  if (r.status !== 200) { bad(`request failed: ${r.data.error}`); process.exit(1); }
  return { requestId: r.data.requestId, questionHash };
};

/* Sign a delegation with a chosen signer, key, vault and expiry. */
const signDelegation = async ({ by = OWNER, key = SESSION, vault = vaultId, expiresIn = 600 }) => {
  const d = Math.floor(Date.now() / 1000) + expiresIn;
  const sig = await by.signTypedData({
    domain, types: { Delegation: DelegationTypes.Delegation }, primaryType: "Delegation",
    message: delegationMessage({ vaultId: vault, sessionKey: key.address, diesAt: d }),
  });
  return { owner: by.address, vaultId: vault, sessionKey: key.address, diesAt: d, sig };
};

/* Answer a request using a session key plus a delegation. */
const answerWith = async ({ signer, delegation, requestId, questionHash }) => {
  const result = {
    answer: "yes",
    band: "",
    answerHash: await sha256hex(JSON.stringify({ answer: "yes", band: "" })),
    enclaveRequestId: `test-${requestId}`,
    provider: "0xD179F4526064846dE9a9E9D93683AF75CB72E503",
    verification: "TeeML",
    latencyMs: 1234,
  };
  const sig = await signer.signTypedData({
    domain, types: { Answer: AnswerTypes.Answer }, primaryType: "Answer",
    message: {
      ...answerMessage({
        requestId, grantId, questionHash,
        answerHash: result.answerHash, enclaveRequestId: result.enclaveRequestId,
      }),
      statement: STATEMENTS.answer,
    },
  });
  return api("/api/answer", {
    body: {
      requestId, owner: OWNER.address, signer: signer.address,
      ownerSig: sig, decision: "answered", delegation, ...result,
    },
  });
};

/* ------------------------------------------------ 2. a stranger ---------- */
step(2, "A delegation signed by someone who is not the owner");
{
  const { requestId, questionHash } = await openRequest();
  const delegation = await signDelegation({ by: STRANGER });
  const r = await answerWith({ signer: SESSION, delegation, requestId, questionHash });
  r.status === 200
    ? bad("a stranger delegated answering rights over someone else's document")
    : ok(`refused (${r.status}): ${String(r.data.error).slice(0, 62)}…`);
}

/* ------------------------------------- 3. the wrong key presenting it ---- */
step(3, "A real delegation, presented by a key it does not name");
{
  const { requestId, questionHash } = await openRequest();
  const delegation = await signDelegation({ key: SESSION });
  // OTHER_KEY signs the answer while waving SESSION's delegation.
  const r = await answerWith({ signer: OTHER_KEY, delegation, requestId, questionHash });
  r.status === 200
    ? bad("any key could answer by replaying somebody else's delegation")
    : ok(`refused (${r.status}): ${String(r.data.error).slice(0, 62)}…`);
}

/* --------------------------------------------- 4. the wrong document ----- */
step(4, "A real delegation for a DIFFERENT document");
{
  const { requestId, questionHash } = await openRequest();
  const delegation = await signDelegation({ vault: otherVaultId });
  const r = await answerWith({ signer: SESSION, delegation, requestId, questionHash });
  r.status === 200
    ? bad("being on call for one document answered about another")
    : ok(`refused (${r.status}): ${String(r.data.error).slice(0, 62)}…`);
}

/* ---------------------------------------------------- 5. expired --------- */
step(5, "A delegation that has already expired");
{
  const { requestId, questionHash } = await openRequest();
  const delegation = await signDelegation({ expiresIn: -60 });
  const r = await answerWith({ signer: SESSION, delegation, requestId, questionHash });
  r.status === 200
    ? bad("an expired delegation still answered - the window does not close")
    : ok(`refused (${r.status}): ${String(r.data.error).slice(0, 62)}…`);
}

/* ------------------------------------------------- 6. the real thing ----- */
step(6, "The exact, live, correctly scoped delegation");
let answeredId = null;
{
  const { requestId, questionHash } = await openRequest();
  answeredId = requestId;
  const delegation = await signDelegation({});
  const r = await answerWith({ signer: SESSION, delegation, requestId, questionHash });
  r.status === 200
    ? ok("accepted - the owner never touched their wallet for this answer")
    : bad(`the honest path was refused (${r.status}): ${r.data.error}`);
}

/* ------------------------------------------- 7. recorded as the owner ---- */
step(7, "The record names the owner, not the throwaway key");
{
  const r = await api(`/api/request?id=${answeredId}`);
  const receipt = r.data?.receipt;
  if (!receipt) {
    bad("no receipt was recorded");
  } else {
    String(receipt.owner).toLowerCase() === OWNER.address.toLowerCase()
      ? ok("the access is attributed to the owner")
      : bad(`the access is attributed to ${receipt.owner}, not the owner`);

    const blob = JSON.stringify(receipt).toLowerCase();
    blob.includes(SESSION.address.toLowerCase())
      ? bad("the receipt leaks the session key")
      : ok("the throwaway key does not appear in the receipt");
  }
}

console.log();
if (fails) {
  console.log(`DELEGATION FAILED — ${fails} problem(s). Do not ship being on call.\n`);
  process.exit(1);
}
console.log("DELEGATION GREEN — the shortcut is narrow: one key, one document, one window.\n");
