# How AskOnly uses Arkiv

Five entities, one of which is the product. Everything in this file is live on Rabdi
(chain `7794095`) and reproducible with the commands at the bottom.

**Writing wallet:** `0x4CA8176777D44B76235684b63334088C618994e4`
**SDK:** `@arkiv-network/sdk@1.0.1` with `viem@2.x`
**Code:** [`src/arkiv/schema.mjs`](../src/arkiv/schema.mjs) ·
[`client.mjs`](../src/arkiv/client.mjs) · [`ledger.mjs`](../src/arkiv/ledger.mjs) ·
[`watch.mjs`](../src/arkiv/watch.mjs)

---

## The shape, in one paragraph

A **vault** is an encrypted document. A **grant** lets one address ask about one vault for a set
time — and *its expiry is the permission itself*, not a field describing one. A **request** is a
question the asker signed, waiting for the owner's browser to answer it. An **access** is the
receipt written when it is answered, signed by the owner's browser. A **refusal** is the receipt
written when a question is turned down.

The grant is the interesting one, so take it first.

---

## 1. `askonly.grant` — the capability, where expiry *is* the permission

```js
export const Grant = defineSchema("askonly.grant", {
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(),
  verifier: addr().indexed(),
  verifierName: str().indexed(),   // a name the owner types, or a short address if blank. Never resolved
  questionSet: str().indexed(),    // income | identity | tenancy | employment | general
  state: str().indexed(),          // live | revoked, and spent on an old counted grant
  usesAllowed: u64().indexed(),    // 0: no count. Grants before 7 Nov carried one
  usesSpent: u64().indexed(),
  issuedAt: u64().indexed(),
  diesAt: u64().indexed(),         // ms, exactly as the owner signed it. $expiresAt follows it
  roleBit: u256(),                 // an ENSv2 EAC role bit, from questionSet. The app never checks it
  labelId: u256(),                 // 0 on every grant the app writes
  threshold: str(),
  note: str(),
  sessionKey: str(),               // the key in the owner's browser that answers under it
  ownerSig: bytes(),               // EIP-712 Grant, by the owner's wallet or by ownerKey
  ownerKey: str(), ownerKeyDiesAt: u64(), ownerKeySig: bytes(),   // that key, and its Session
});
```

Created with a required expiration, and **that is how it runs out**:

```js
await wallet.createEntity(Grant, values, { expiration: ExpirationTime.fromMinutes(2) }, { gas });
```

Running out needs no `isActive` boolean that a buggy code path can forget to check, and no
scheduled job that can quietly stop running. Past the death block the network stops returning
the entity and every operation on it fails. Ending a permission early is different: the owner
signs a `Revoke`, the server sets `state` to `revoked`, and it keeps the id in memory so an
answer already queued behind the revoke is refused.

The verifier-facing API leans on this directly — `GET /api/grant?id=…` returns **404 when the
capability has expired**, and the UI renders that 404 as the expiry rather than as an error:

```js
const g = await liveGrant(reader, grantId);
if (!g) return { expired: true,
  explain: "Past its death block Arkiv stops returning the entity and every operation fails." };
```

**`state` is an explicit enum because the network has no `NOT` and no `!=`.** "Not yet spent" is
inexpressible, so on an old counted grant `spent` is written at the moment the last use is
consumed. Grants now carry no count; the server allows 10 questions waiting on one permission,
and 30 in 10 minutes.

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
  ownerSig: bytes(),            // EIP-712 Seal over (sha256, label), by the owner's wallet or by ownerKey
  ownerKey: str(), ownerKeyDiesAt: u64(), ownerKeySig: bytes(),   // that key, and its Session
});
```

`cipher` is the document. It is encrypted in the owner's browser (AES-GCM-256, key derived by
PBKDF2 at 210,000 iterations from a passphrase that never leaves the page) and arrives here as
opaque bytes. A `bytes` column holds **128 KiB per create**, which fits an encrypted payslip —
so we store the document in Arkiv itself rather than in a second system, and **the ciphertext
expires along with everything else**.

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
  verification: str().indexed(),   // provider-address | no-lines-matched
  at: u64().indexed(),
  question: str(), band: str(), teeType: str(),
  linesSeen: str(),                // "3/17": how much of the document the enclave was shown
  latencyMs: u64(),
  askerSig: bytes(),               // the answering key's EIP-712 signature over the Answer
});
```

Each receipt rests on two signatures. The asker signs the question first, an EIP-712 `Request` over
`(grantId, questionHash, askedAt)`, and it is stored on the request **before anything is
answered**. They cannot be told the answer without leaving a record that they asked. The owner's
browser then signs the answer with a key it holds, an EIP-712 `Answer` over `(requestId,
grantId, questionHash, answerHash, enclaveRequestId)`, and that is what `askerSig` holds. The
name is older than its meaning.

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
  reason: str().indexed(),   // out-of-scope | owner-declined
  at: u64().indexed(),
  question: str(), detail: str(),
});
```

"Who tried to ask something they were not allowed to ask" is exactly as interesting to a data
subject as who asked legitimately, and it is the record a consent manager would be expected to
keep. The app writes two reasons. `out-of-scope` is the enclave's verdict that a question is
outside what the owner allowed, so by then the owner's browser has opened the document and
asked the enclave. `owner-declined` is any other refusal the owner's side signs.

---

## 5. `askonly.request` — the queue the owner's browser answers from

```js
export const Request = defineSchema("askonly.request", {
  requestId: str().indexed(),      // q- + 12 hex of the signed Request's EIP-712 hash
  grantId: str().indexed(),
  vaultId: str().indexed(),
  owner: addr().indexed(),         // whose inbox this lands in
  asker: addr().indexed(),
  askerName: str().indexed(),      // the grant's verifierName, copied
  questionSet: str().indexed(),
  questionHash: str().indexed(),
  state: str().indexed(),          // pending, then answered or refused
  askedAt: u64().indexed(),        // ms, as the asker signed it
  decidedAt: u64().indexed(),
  accessId: str().indexed(),       // the receipt, once answered
  question: str(),
  askerSig: bytes(),               // EIP-712 Request, signed before anything is answered
  askerKey: str(), askKeySig: bytes(), askKeyDiesAt: u64(),   // the asker's browser key, if any
});
```

Only the owner's browser holds the passphrase, so the asker cannot produce an answer, only ask
for one. The server checks the asker's signature and writes the question here as `pending`. The
owner's browser polls its inbox (`owner` + `state`), checks both signatures itself, and answers.
The server then settles it in one batch: the receipt, this entity's new `state`, and a use
counted on the grant. A request lives 7 days, so the asker can still read what came back after
the permission ends.

---

## The queries the app runs

Reads cost no gas, so none of these needs a funded wallet. The first query shapes were validated
against the live network **with a zero-balance wallet**, before anything was funded.

```js
// every read is .createdBy(ours()), the writing wallet: a schema is only a name,
// and any wallet can tag an entity with it

// 1. the capability, by id - returns nothing once it has died
.select({ $key: true, $expiresAt: true, grantId: true, state: true, /* … */ })
.from(Grant).createdBy(ours()).where(eq("grantId", str(grantId))).limit(1).fetch()

// 2. an owner's permissions, newest first
.from(Grant).createdBy(ours()).where(eq("owner", addr(owner))).orderBy(desc("issuedAt")).limit(50)

// 3. the owner's inbox: theirs AND still waiting - two positive predicates, because there is no NOT
.from(Request).createdBy(ours()).where(and(eq("owner", addr(owner)), eq("state", str("pending"))))
  .orderBy(desc("askedAt")).limit(100)

// 4. every question under one permission, which the asker's page polls
.from(Request).createdBy(ours()).where(eq("grantId", str(grantId))).orderBy(desc("askedAt")).limit(50)

// 5. a count without fetching rows: how many are still waiting, for the limit of 10
reader.count().from(Request).createdBy(ours())
  .where(and(eq("grantId", str(grantId)), eq("state", str("pending")))).fetch()

// 6. "who asked about me"
.from(Access).createdBy(ours()).where(eq("owner", addr(owner))).orderBy(desc("at")).limit(100)

// 7. what was refused on my behalf
.from(Refusal).createdBy(ours()).where(eq("owner", addr(owner))).orderBy(desc("at"))
```

The rest have the same shape: a reviewer's permissions by `verifier`, an owner's live documents
by `owner` + `state`, single records by `vaultId`, `requestId` and `accessId`, and the receipts
and refusals under one permission by `grantId`.

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
