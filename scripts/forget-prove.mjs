/**
 * AskOnly — prove that deleting a document is the owner's alone, and does what it says.
 *
 *   node --env-file=.env scripts/forget-prove.mjs
 *
 * Owners can delete a sealed document, and nothing undoes that, so:
 *
 *   - an unsigned request is refused
 *   - a request signed by somebody who is not the owner is refused
 *   - a signature over a DIFFERENT document is refused (no replay onto another
 *     vault, which is the obvious way to turn one legitimate deletion into an
 *     attack on somebody else's)
 *   - the owner's own signature works
 *   - afterwards the network no longer SERVES the ciphertext
 *
 * What this does not prove, because it is not true: that the bytes are gone from
 * history. The create transaction is still in old blocks, encrypted exactly as it
 * always was. Same boundary the landing page states for expiry.
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { sealedBody } from "./seal.mjs";
import { ForgetTypes, forgetMessage, domain, STATEMENTS } from "../src/auth/typed.mjs";

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

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256hex = async (t) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));

const OWNER = privateKeyToAccount(generatePrivateKey());
const STRANGER = privateKeyToAccount(generatePrivateKey());

console.log(`AskOnly — deleting a document
  owner     ${OWNER.address}
  stranger  ${STRANGER.address}`);

/* --------------------------------------------------------------- setup -- */
step(1, "The owner seals two documents");

const seal = async (label) => {
  const r = await api("/api/vault", {
    // A real, non-trivial ciphertext, so "the bytes are gone" means something.
    body: await sealedBody(OWNER, { label, docKind: "a letter from my employer", bytes: 2048 }),
  });
  if (r.status !== 200) { bad(`seal failed: ${JSON.stringify(r.data)}`); process.exit(1); }
  return r.data.vaultId;
};

const target = await seal("The one being destroyed");
const bystander = await seal("The one that must survive");
ok(`${target} and ${bystander}`);

const before = await api(`/api/vault?id=${encodeURIComponent(target)}`);
const cipherBefore = String(before.data.cipher ?? "");
if (cipherBefore.length > 2) ok(`it holds ${(cipherBefore.length - 2) / 2} bytes of ciphertext`);
else { bad("nothing was stored, so the rest of this proves nothing"); process.exit(1); }

/** Sign a Forget over whichever vaultId we choose, as whoever we choose. */
const sign = (account, vaultId) =>
  account.signTypedData({
    domain,
    types: { Forget: ForgetTypes.Forget },
    primaryType: "Forget",
    message: forgetMessage({ vaultId }),
  });

/* ------------------------------------------------------- the refusals -- */
step(2, "An unsigned deletion");
{
  const r = await api("/api/vault/forget", { body: { vaultId: target, owner: OWNER.address } });
  if (r.status === 200) bad("an unsigned request destroyed a document");
  else ok(`refused (${r.status}): ${String(r.data.error).slice(0, 60)}…`);
}

step(3, "A stranger signing their own deletion of someone else's document");
{
  const sig = await sign(STRANGER, target);
  const r = await api("/api/vault/forget", {
    body: { vaultId: target, owner: STRANGER.address, ownerSig: sig },
  });
  if (r.status === 200) bad("a stranger destroyed the owner's document");
  else ok(`refused (${r.status}): ${String(r.data.error).slice(0, 60)}…`);
}

step(4, "A stranger replaying the OWNER's address with their own signature");
{
  // The body claims to be the owner; the signature is the stranger's. The
  // server must recover the signer rather than believe the body.
  const sig = await sign(STRANGER, target);
  const r = await api("/api/vault/forget", {
    body: { vaultId: target, owner: OWNER.address, ownerSig: sig },
  });
  if (r.status === 200) bad("the server believed the body instead of the signature");
  else ok(`refused (${r.status}): ${String(r.data.error).slice(0, 60)}…`);
}

step(5, "The owner's real signature, aimed at a DIFFERENT document");
{
  // A genuine owner signature over `bystander`, submitted against `target`.
  const sig = await sign(OWNER, bystander);
  const r = await api("/api/vault/forget", {
    body: { vaultId: target, owner: OWNER.address, ownerSig: sig },
  });
  if (r.status === 200) bad("a signature for one document destroyed another");
  else ok(`refused (${r.status}): ${String(r.data.error).slice(0, 60)}…`);
}

/* ---------------------------------------------------- the real thing -- */
step(6, "The owner destroys their own document");
{
  const sig = await sign(OWNER, target);
  const r = await api("/api/vault/forget", {
    body: { vaultId: target, owner: OWNER.address, ownerSig: sig },
  });
  if (r.status !== 200) { bad(`the owner was refused: ${JSON.stringify(r.data)}`); }
  else ok(`accepted — state is now "${r.data.state}"`);
}

step(7, "The network no longer serves the ciphertext");
{
  const after = await api(`/api/vault?id=${encodeURIComponent(target)}`);
  const cipherAfter = String(after.data.cipher ?? "");
  const bytes = cipherAfter.startsWith("0x") ? (cipherAfter.length - 2) / 2 : cipherAfter.length / 2;
  if (bytes > 0) bad(`${bytes} bytes of ciphertext are still being served`);
  else ok("it serves zero bytes now");
}

step(8, "It has left the owner's vault, and the other document has not");
{
  const list = await api(`/api/vaults?owner=${OWNER.address}`);
  const ids = (list.data.vaults ?? []).map((v) => v.vaultId);
  if (ids.includes(target)) bad("the destroyed document is still listed");
  else ok("the destroyed document is no longer listed");
  if (ids.includes(bystander)) ok("the other document is untouched");
  else bad("the wrong document disappeared");
}

step(9, "Destroying it a second time");
{
  const sig = await sign(OWNER, target);
  const r = await api("/api/vault/forget", {
    body: { vaultId: target, owner: OWNER.address, ownerSig: sig },
  });
  if (r.status === 200) bad("a second deletion was accepted, and paid for");
  else ok(`refused (${r.status}): ${String(r.data.error).slice(0, 60)}…`);
}

console.log(
  fails === 0
    ? "\nFORGET GREEN — only the owner can delete a document, only the one they named,\nand the network stops serving it."
    : `\n${fails} FAILED`,
);
process.exit(fails === 0 ? 0 : 1);
