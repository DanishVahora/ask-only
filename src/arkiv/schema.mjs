/**
 * AskOnly — Arkiv schemas.
 *
 * Four entities. The important one is `grant`: its `$expiresAt` IS the permission.
 * There is no `revoked` boolean to flip and no cron to run — past the death block the
 * network stops returning it and every operation on it fails.
 *
 * Constraints these schemas are built against (all verified, see arkiv/friction.md):
 *   - 32 attributes per entity, 31 for a named schema.
 *   - `str` is 128 BYTES, not characters. Use fitStr() before writing user text.
 *   - `bytes` is 128 KiB per column AND 128 KiB total per create/patch.
 *   - `bytes` can never be indexed, filtered or sorted.
 *   - The network has NO `!=` and NO `NOT`. Every filter must be expressible
 *     positively, so every lifecycle state is an explicit enum we patch on
 *     transition - never the absence of a value.
 *   - `bytes32` does not exist in 1.0.x. Use `key`.
 */

import { defineSchema, str, addr, u64, u256, bytes } from "@arkiv-network/sdk/schema";

/** Arkiv `str` is 128 BYTES. Truncate on a byte boundary so a multi-byte
 *  character (Devanagari, emoji, a rupee sign) can never be cut in half. */
export const MAX_STR = 128;
export function fitStr(value, max = MAX_STR) {
  const s = String(value ?? "");
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  // Walk back by code point until the encoded form fits.
  const points = Array.from(s);
  let out = "";
  for (const ch of points) {
    if (enc.encode(out + ch).length > max - 1) break;
    out += ch;
  }
  return out + "…";
}

/* ---------------------------------------------------------------------------
   1. VAULT - the encrypted document.

   The ciphertext itself carries a death block, so the document structurally
   expires rather than merely being marked deleted. `cipher` is written by the
   owner's browser and is NEVER decrypted server-side.
   ------------------------------------------------------------------------ */
export const Vault = defineSchema("askonly.vault", {
  vaultId: str().indexed(),
  owner: addr().indexed(),
  docKind: str().indexed(), // payslip | bank | rent | identity | other
  state: str().indexed(), // live | retired
  sha256: str().indexed(), // hash of the PLAINTEXT, so the owner can prove which document
  bytesLen: u64().indexed(), // ciphertext length, shown in the UI
  createdAt: u64().indexed(), // ms

  label: str(), // "Payslip - Oct 2026", owner-facing only
  iv: str(), // base64 AES-GCM nonce
  cipher: bytes(), // AES-GCM-256 ciphertext. Encrypted in the browser. Never readable here.
});

/* ---------------------------------------------------------------------------
   2. GRANT - the capability.

   `$expiresAt` is not metadata about the permission, it IS the permission.
   `state` exists because the network cannot express "not spent".
   ------------------------------------------------------------------------ */
export const Grant = defineSchema("askonly.grant", {
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(),
  verifier: addr().indexed(),
  verifierName: str().indexed(), // "landlord.eth" - the ENS name, not a label
  questionSet: str().indexed(), // income | identity | tenancy | employment
  state: str().indexed(), // live | spent | revoked
  usesAllowed: u64().indexed(),
  usesSpent: u64().indexed(),
  issuedAt: u64().indexed(), // ms
  diesAt: u64().indexed(), // ms - mirrors $expiresAt for display and sorting

  roleBit: u256(), // the ENSv2 EAC role the verifier must hold
  labelId: u256(), // the ENS resource the role is checked against
  threshold: str(), // e.g. "50000" - the figure inside the question, never the document's
  note: str(), // what the owner was told they were granting
  ownerSig: bytes(), // EIP-712 signature of the principal over the grant terms
});

/* ---------------------------------------------------------------------------
   3. ACCESS - the receipt, and the genuinely novel artifact here.

   Not "we say he asked X". The answer is released to the verifier's screen only
   against `askerSig`, their own EIP-712 signature over
   (grantId, questionHash, answerHash, requestId). So the verifier cannot be told
   the answer without signing for having asked.

   0G does NOT sign the answer - GET /v1/proxy/signature/{chatID} does not exist
   on the Router (8 paths probed with a live chatID, all 404). So provider identity
   is bound by ADDRESS and checked against GET /providers?model=, and `teeSelfReport`
   is labelled in the UI as the router's own claim rather than a proof.
   ------------------------------------------------------------------------ */
export const Access = defineSchema("askonly.access", {
  accessId: str().indexed(),
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(), // so the data principal can run "who asked about me"
  asker: addr().indexed(),
  askerName: str().indexed(),
  questionHash: str().indexed(), // sha256 of the exact canonical question
  answer: str().indexed(), // yes | no | unknown
  answerHash: str().indexed(), // sha256 of the enclave's exact JSON reply
  requestId: str().indexed(), // 0G x_0g_trace.request_id - the load-bearing id
  provider: addr().indexed(), // which enclave address answered
  model: str().indexed(),
  trustMode: str().indexed(), // private
  verification: str().indexed(), // provider-address | request-id-only  (positive enum)
  at: u64().indexed(), // ms

  question: str(), // canonical question text
  band: str(), // coarse band if the question set allows one. Never an exact figure.
  teeType: str(), // TDX / dstack, as reported by /providers
  latencyMs: u64(),
  askerSig: bytes(), // EIP-712 signature of the VERIFIER over the receipt
});

/* ---------------------------------------------------------------------------
   4. REFUSAL - a refused question is evidence too.

   "Who tried to ask something they were not allowed to ask" is exactly as
   interesting to a data principal as who asked legitimately, and it is the
   record a Consent Manager would be expected to keep.
   ------------------------------------------------------------------------ */
export const Refusal = defineSchema("askonly.refusal", {
  refusalId: str().indexed(),
  grantId: str().indexed(),
  owner: addr().indexed(),
  asker: addr().indexed(),
  questionHash: str().indexed(),
  reason: str().indexed(), // no-ens-role | out-of-set | uses-exhausted | expired | revoked
  at: u64().indexed(),

  question: str(),
  detail: str(),
});

/* ---------------------------------------------------------------------------
   5. REQUEST - the second party, made real.

   This entity is why AskOnly is a protocol rather than a demo. Only the owner's
   device holds the passphrase, so only the owner's device can decrypt and ask
   the enclave. The verifier therefore cannot produce an answer - they can only
   REQUEST one, and wait.

   So a request lands here as `pending`, the owner's device sees it, and the
   answer is written by the owner. The verifier never holds a key, a passphrase,
   or a document. This is the shape a DPDP consent manager has, and it is the
   shape the cryptography forces.
   ------------------------------------------------------------------------ */
export const Request = defineSchema("askonly.request", {
  requestId: str().indexed(),
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(), // whose inbox this lands in
  asker: addr().indexed(),
  askerName: str().indexed(),
  questionSet: str().indexed(),
  questionHash: str().indexed(),
  // pending | answered | refused | withdrawn. A positive enum, because the
  // network has no NOT and "not yet answered" is otherwise inexpressible.
  state: str().indexed(),
  askedAt: u64().indexed(),
  decidedAt: u64().indexed(), // 0 until decided
  accessId: str().indexed(), // the receipt, once answered

  question: str(),
  askerSig: bytes(), // EIP-712 - the verifier signed BEFORE being told anything
});

/** Question sets -> ENSv2 EAC role bits.
 *
 *  A nybble in EnhancedAccessControl is a BOOLEAN, not a 0-15 level: every bitmap
 *  is validated against ALL_ROLES = 0x1111...1111 (64 ones) and reverts
 *  EACInvalidRoleBitmap if any bit outside a nybble's low bit is set.
 *  So `1n << 40n` is legal and `0xFn << 40n` is REJECTED - N sets means N nybbles.
 *  ENS itself occupies nybbles 0-6, 8, 9, 30, 31; nybbles 7 and 10-29 are free.
 */
export const QUESTION_SETS = {
  income: {
    roleBit: 1n << 40n, // nybble 10
    nybble: 10,
    label: "Income",
    ask: (threshold) => `Is monthly income above INR ${threshold}?`,
    allowsBand: true,
  },
  identity: {
    roleBit: 1n << 44n, // nybble 11
    nybble: 11,
    label: "Identity",
    ask: (name) => `Does the name on this document match "${name}"?`,
    allowsBand: false,
  },
  tenancy: {
    roleBit: 1n << 48n, // nybble 12
    nybble: 12,
    label: "Tenancy",
    ask: () => `Is there an active tenancy, with rent paid to date?`,
    allowsBand: false,
  },
  employment: {
    roleBit: 1n << 52n, // nybble 13
    nybble: 13,
    label: "Employment",
    ask: (months) => `Has this person been employed for more than ${months} months?`,
    allowsBand: true,
  },
};

/** EnhancedAccessControl legality check - the same validation the live registry runs. */
export const ALL_ROLES = BigInt("0x" + "1".repeat(64));
export const isLegalRoleBitmap = (bits) => (BigInt(bits) & ~ALL_ROLES) === 0n;

/** The admin counterpart of a role is the role shifted by 128. */
export const adminOf = (roleBit) => BigInt(roleBit) << 128n;

export const SCHEMAS = { Vault, Grant, Access, Refusal, Request };
