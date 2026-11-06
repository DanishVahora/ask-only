# How AskOnly uses Arkiv

Four entities, one of which is the product. Everything in this file is live on Rabdi
(chain `7794095`) and reproducible with the commands at the bottom.

**Writing wallet:** `0x4CA8176777D44B76235684b63334088C618994e4`
**SDK:** `@arkiv-network/sdk@1.0.1` with `viem@2.x`
**Code:** [`src/arkiv/schema.mjs`](../src/arkiv/schema.mjs) ·
[`client.mjs`](../src/arkiv/client.mjs) · [`ledger.mjs`](../src/arkiv/ledger.mjs) ·
[`watch.mjs`](../src/arkiv/watch.mjs)

---

## The shape, in one paragraph

A **vault** is an encrypted document. A **grant** is a capability to ask one question about one
vault — and *its expiry is the permission itself*, not a field describing one. An **access** is
the receipt written when a question is answered, bound to the asker's own signature. A
**refusal** is the receipt written when someone asks something they were not permitted to.

The grant is the interesting one, so take it first.

---

## 1. `askonly.grant` — the capability, where expiry *is* the permission

```js
export const Grant = defineSchema("askonly.grant", {
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(),
  verifier: addr().indexed(),
  verifierName: str().indexed(),   // "landlord.eth"
  questionSet: str().indexed(),    // income | identity | tenancy | employment
  state: str().indexed(),          // live | spent | revoked
  usesAllowed: u64().indexed(),
  usesSpent: u64().indexed(),
  issuedAt: u64().indexed(),
  diesAt: u64().indexed(),         // ms, mirrors $expiresAt for display and sorting
  roleBit: u256(),                 // the ENSv2 EAC role the verifier must hold
  labelId: u256(),
  threshold: str(),
  note: str(),
  ownerSig: bytes(),
});
```

Created with a required expiration, and **that is the whole revocation mechanism**:

```js
await wallet.createEntity(Grant, values, { expiration: ExpirationTime.fromMinutes(2) }, { gas });
```

There is no `isActive` boolean that a buggy code path can forget to check, and no scheduled job
that can quietly stop running. Past the death block the network stops returning the entity and
every operation on it fails.

The verifier-facing API leans on this directly — `GET /api/grant?id=…` returns **404 when the
capability has expired**, and the UI renders that 404 as the expiry rather than as an error:

```js
const g = await liveGrant(reader, grantId);
if (!g) return { expired: true,
  explain: "Past its death block Arkiv stops returning the entity and every operation fails." };
```

**`state` is an explicit enum because the network has no `NOT` and no `!=`.** "Not yet spent" is
inexpressible, so `spent` is written at the moment the last use is consumed.

---

## 2. `askonly.vault` — the document, carrying its own death block

```js
export const Vault = defineSchema("askonly.vault", {
  vaultId: str().indexed(),
  owner: addr().indexed(),
  docKind: str().indexed(),
  state: str().indexed(),
  sha256: str().indexed(),      // hash of the CIPHERTEXT. Of the plaintext, a short document could be guessed
  bytesLen: u64().indexed(),
  createdAt: u64().indexed(),
  label: str(),
  iv: str(),
  cipher: bytes(),              // AES-GCM-256, encrypted in the browser. Never decrypted server-side.
});
```

`cipher` is the document. It is encrypted in the owner's browser (AES-GCM-256, key derived by
PBKDF2 at 210,000 iterations from a passphrase that never leaves the page) and arrives here as
opaque bytes. A `bytes` column holds **128 KiB per create**, which fits a compressed encrypted
payslip — so we store the document in Arkiv itself rather than in a second system, and **the
ciphertext expires along with everything else**.

`bytes` can never be indexed, filtered or sorted, which is correct and also convenient: there is
no way to query documents by content even by accident.

---

## 3. `askonly.access` — the receipt, and the part that is actually novel

```js
export const Access = defineSchema("askonly.access", {
  accessId: str().indexed(),
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(),         // so the data principal can run "who asked about me"
  asker: addr().indexed(),
  askerName: str().indexed(),
  questionHash: str().indexed(),   // sha-256 of the exact canonical question
  answer: str().indexed(),         // yes | no | unknown
  answerHash: str().indexed(),
  requestId: str().indexed(),      // 0G x_0g_trace.request_id
  provider: addr().indexed(),      // which enclave address answered
  model: str().indexed(),
  trustMode: str().indexed(),
  verification: str().indexed(),   // provider-address | request-id-only
  at: u64().indexed(),
  question: str(), band: str(), teeType: str(),
  latencyMs: u64(),
  askerSig: bytes(),               // EIP-712 signature of the VERIFIER
});
```

`askerSig` is the load-bearing field. The answer is **not shown to the verifier until they sign
an EIP-712 receipt** over `(grantId, questionHash, answerHash, requestId)`. They cannot be told
the answer without producing a record that they asked.

This is where we are deliberately narrower than our original design. We intended to store a TEE
signature over the response and verify it against the provider's on-chain signer. **0G's router
exposes no such endpoint** — we probed eight path shapes with a live `chatcmpl` id, all 404. So
`verification` says `provider-address`, never `signature`, and the enclave's identity is
established by address against the live provider list instead. The schema records what we can
actually prove.

---

## 4. `askonly.refusal` — because a refused question is evidence too

```js
export const Refusal = defineSchema("askonly.refusal", {
  refusalId: str().indexed(), grantId: str().indexed(),
  owner: addr().indexed(), asker: addr().indexed(),
  questionHash: str().indexed(),
  reason: str().indexed(),   // no-ens-role | out-of-set | uses-exhausted | expired | revoked
  at: u64().indexed(),
  question: str(), detail: str(),
});
```

"Who tried to ask something they were not allowed to ask" is exactly as interesting to a data
subject as who asked legitimately, and it is the record a consent manager would be expected to
keep. It is also the demo's best beat: the refusal is written *before* the document is touched.

---

## The six queries the app runs

All of these were validated against the live network **with a zero-balance wallet**, because
reads cost no gas.

```js
// 1. the capability, by id - returns nothing once it has died
.select({ $key: true, $expiresAt: true, grantId: true, state: true, /* … */ })
.from(Grant).where(eq("grantId", str(grantId))).limit(1).fetch()

// 2. an owner's permissions, newest first
.from(Grant).where(eq("owner", addr(owner))).orderBy(desc("issuedAt")).limit(50)

// 3. still alive AND not used up - two positive predicates, because there is no NOT
.from(Grant).where(and(eq("owner", addr(owner)), eq("state", str("live")))).orderBy(asc("diesAt"))

// 4. "who asked about me"
.from(Access).where(eq("owner", addr(owner))).orderBy(desc("at")).limit(100)

// 5. what was refused on my behalf
.from(Refusal).where(eq("owner", addr(owner))).orderBy(desc("at"))

// 6. a count without fetching rows
reader.count().from(Grant).where(eq("state", str("live"))).fetch()
```

Every value is wrapped in its type tag. A bare JS value fails client-side with a very good
error, and a bare number would be an `i32`.

---

## Expiry and retention, in code

```js
// the capability's whole lifetime, set at creation
{ expiration: ExpirationTime.fromMinutes(2) }   // or fromDays(7)

// extension - the one deliberately LOUD operation. Note the object form.
await wallet.extendEntity({ entityKey, expiration: ExpirationTime.fromDays(7) }, { gas });
```

And the monitor, which must be filtered because the event stream is chain-wide:

```js
reader.watchEntityEvents({
  onExpiryExtended: ({ entityKey, owner, expiresAt, transactionHash }) => {
    if (!mine(entityKey, owner)) return;   // 44 of 45 events measured were strangers'
    onExtended({ entityKey, owner, newExpiryBlock: expiresAt?.toString(), txHash: transactionHash });
  },
});
```

`watchExtensions()` **throws rather than starting unfiltered**, and reports the drop count,
because the number of events discarded is itself the evidence that the filter is necessary.

---

## The guarded write path

```js
// refuse to start on an unreconciled pending nonce
if (pending !== latest) throw safeError("reconcile the pending nonce before writing");
// explicit gas floor, capped at half the block limit so a bad value fails locally
const floor = 1_000_000n + 400_000n * BigInt(operations - 1);
if (floor > block.gasLimit / 2n) throw safeError("gas floor exceeds half the block limit");
```

Plus mandatory error scrubbing, since `rabdi({ accessKey })` path-encodes the access key into
the RPC URL and an unscrubbed error would print it.

---

## Run it yourself

```bash
npm install
cp .env.example .env     # add ARKIV_ACCESS_KEY and DEPLOYER_PRIVATE_KEY

npm run preflight            # proves Arkiv, ENSv2 and the 0G enclave are all live
node --env-file=.env scripts/arkiv-prove.mjs      # writes a vault, a grant, a receipt, a refusal
node --env-file=.env scripts/arkiv-expiry.mjs <grantId>   # watch a permission die
node --env-file=.env scripts/arkiv-retention.mjs  # prove extension is loud and death is silent
```

The judge-runnable one-liner is in the [README](../README.md#a-query-you-can-run).
