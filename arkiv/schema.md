# Schema

Five entities on Arkiv Rabdi (chain `7794095`), defined in
[`src/arkiv/schema.mjs`](../src/arkiv/schema.mjs) with `@arkiv-network/sdk@1.0.1`.

Namespace: `askonly.*`. Writing wallet: `0x4CA8176777D44B76235684b63334088C618994e4`.

**Every read filters on `$creator`, the writing wallet.** A schema is only a name, and any wallet
can tag an entity with it, so a read by schema alone would return whatever anybody planted: a
question nobody signed, or a receipt that outranks the real one. `$creator`, unlike `$owner`,
cannot be transferred.

**Some of this is personal data, and everything readable on Arkiv is public.** The document is
only ever stored as AES-GCM-256 ciphertext encrypted in the owner's browser. But each question is
stored word for word with its answer, and so are the document's `label`, the scope the owner
wrote (`note`) and the reviewer's display name (`verifierName`, copied to `askerName`), which is
free text and indexed. The rest of what is indexed is ids, hashes, addresses, enums, counts and
times.

---

## `askonly.vault` — an encrypted document

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `vaultId` | `str` | ✓ | `v-` + 8 hex, the handle used everywhere |
| `owner` | `addr` | ✓ | the data principal |
| `docKind` | `str` | ✓ | `document`. Nothing in the protocol cares what kind of thing it is |
| `state` | `str` | ✓ | `live` `retired` |
| `sha256` | `str` | ✓ | sha-256 of the **ciphertext**. Of the plaintext, a short or templated document could be guessed and checked offline |
| `bytesLen` | `u64` | ✓ | ciphertext length |
| `createdAt` | `u64` | ✓ | ms since epoch |
| `label` | `str` | | owner-facing name, e.g. `Payslip — Oct 2026` |
| `iv` | `str` | | base64 AES-GCM nonce |
| `cipher` | `bytes` | | the document. Encrypted in the browser, never decrypted server-side |
| `ownerSig` | `bytes` | | EIP-712 `Seal` over (`sha256`, `label`), by the owner's wallet or by `ownerKey`. The server hashes the bytes it was sent and refuses a mismatch. Empty on documents sealed before sealing was signed |
| `ownerKey` | `str` | | the browser key that signed for the owner, or empty if their wallet did |
| `ownerKeyDiesAt` | `u64` | | seconds, when that key's `Session` ends; `0` with no key |
| `ownerKeySig` | `bytes` | | the owner's wallet over that `Session`, which traces `ownerSig` back to them |

`$expiresAt`: owner's choice, default 180 days.
`cipher` is capped by Arkiv at **128 KiB per create**, the signatures included, which fits an encrypted payslip.
A `bytes` column can never be indexed, filtered or sorted — so documents cannot be queried by
content even by accident.

---

## `askonly.grant` — the capability

**The entity whose expiry *is* the permission.** Running out needs no `isActive` flag and no
job: past `$expiresAt` the network stops returning it and every operation on it fails. Ending one
early is a signed `Revoke`: the server sets `state` to `revoked`, and keeps the id in memory so an
answer already queued is refused.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `grantId` | `str` | ✓ | `g-` + 12 hex of the EIP-712 hash of the signed terms, so one signature makes one permission |
| `vaultId` | `str` | ✓ | joins to the document |
| `owner` | `addr` | ✓ | who granted it |
| `verifier` | `addr` | ✓ | who may ask |
| `verifierName` | `str` | ✓ | a display name the owner types, e.g. `Landlord`, or a shortened address if they leave it blank. Free text, never resolved |
| `questionSet` | `str` | ✓ | `income` `identity` `tenancy` `employment`, or `general`: a coarse tag the browser guesses from the scope |
| `state` | `str` | ✓ | `live` `revoked`, and `spent` on an old counted grant that ran out |
| `usesAllowed` | `u64` | ✓ | `0`: no count, the reviewer asks as often as they like while it lasts. Grants before 2026-11-07 carried one, signed under the old `Grant` type, and still hold to it |
| `usesSpent` | `u64` | ✓ | questions answered or turned down |
| `issuedAt` | `u64` | ✓ | ms |
| `diesAt` | `u64` | ✓ | ms, **exactly as the owner signed it**. `$expiresAt` follows it to the next 2s block |
| `roleBit` | `u256` | | an ENSv2 EAC role bit, picked from `questionSet`. Nothing in the app checks it |
| `labelId` | `u256` | | the ENS resource a role would be checked against. `0` on every grant the app writes |
| `threshold` | `str` | | the figure inside the question — never the document's |
| `note` | `str` | | the owner's own words for what may be asked, or `anything in this document` |
| `sessionKey` | `str` | | the key in the owner's browser that may answer under this grant, named in their signature |
| `ownerSig` | `bytes` | | EIP-712 signature over the grant terms, by the principal's wallet or by `ownerKey` |
| `ownerKey` | `str` | | the browser key that signed for the owner, or empty if their wallet did |
| `ownerKeyDiesAt` | `u64` | | seconds, when that key's `Session` ends; `0` with no key |
| `ownerKeySig` | `bytes` | | the owner's wallet over that `Session`, which traces `ownerSig` back to them |

`$expiresAt`: **required at creation**, and how the permission runs out.
`state` is an explicit enum because the network has **no `NOT` and no `!=`** — "not yet spent"
cannot be expressed, so on an old counted grant `spent` is written at the moment the last use is consumed.
With no count, what stops a runaway script is the server: at most 10 questions waiting on one
permission, and 30 in 10 minutes.
`roleBit` and `labelId` are for `contracts/AskOnlyGate.sol`, deployed on Sepolia, which checks an
ENSv2 role with `hasRoles`. The app does not call it when a question is asked or answered.

---

## `askonly.access` — the receipt

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `accessId` | `str` | ✓ | `a-` + 8 hex |
| `grantId` | `str` | ✓ | which capability authorised it |
| `vaultId` | `str` | ✓ | which document |
| `owner` | `addr` | ✓ | lets the principal run "who asked about me" |
| `asker` | `addr` | ✓ | who asked |
| `askerName` | `str` | ✓ | the grant's `verifierName`, copied |
| `questionHash` | `str` | ✓ | sha-256 of the exact canonical question |
| `answer` | `str` | ✓ | `yes` `no` `unknown` |
| `answerHash` | `str` | ✓ | sha-256 of `{answer, band}`, recomputed by the server before it writes |
| `requestId` | `str` | ✓ | 0G `x_0g_trace.request_id` |
| `provider` | `addr` | ✓ | the enclave address that answered |
| `model` | `str` | ✓ | e.g. `glm-5.3` |
| `trustMode` | `str` | ✓ | `private` |
| `verification` | `str` | ✓ | `provider-address`, or `no-lines-matched` when the browser answered `unknown` without asking the enclave — **never `signature`** |
| `at` | `u64` | ✓ | ms |
| `question` | `str` | | the question verbatim |
| `band` | `str` | | one word from a fixed list, e.g. `comfortably above`, or empty. Never a figure |
| `teeType` | `str` | | e.g. `TDX/dstack`, as reported by `/providers` |
| `linesSeen` | `str` | | how much of the document the enclave was shown, e.g. `3/17` |
| `latencyMs` | `u64` | | how long the enclave took |
| `askerSig` | `bytes` | | the answering key's EIP-712 signature over the Answer. The name is older than its meaning |

`$expiresAt`: 180 days. The receipt deliberately outlives the capability — the permission must
die, the record of its use must not.

On `verification`: we intended to store a TEE signature over the response. 0G's router exposes
no signature endpoint (eight path shapes probed with a live `chatcmpl` id, all 404), so the
enclave's identity is bound by **address**, checked live against `GET /providers?model=`. The
field records what we can prove, not what we hoped to.

---

## `askonly.refusal` — a refused question is evidence too

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `refusalId` | `str` | ✓ | `r-` + 8 hex |
| `grantId` | `str` | ✓ | the capability involved, or `none` |
| `owner` | `addr` | ✓ | whose document was protected |
| `asker` | `addr` | ✓ | who tried |
| `questionHash` | `str` | ✓ | sha-256 of what they tried to ask |
| `reason` | `str` | ✓ | `out-of-scope`, the enclave's verdict that a question is outside what the owner allowed, or `owner-declined`. The app writes no others |
| `at` | `u64` | ✓ | ms |
| `question` | `str` | | verbatim |
| `detail` | `str` | | human-readable explanation |

`$expiresAt`: 180 days.

---

## `askonly.request` — the second party

The entity that makes AskOnly a protocol rather than a demo. Only the owner's device holds the
passphrase, so only the owner's device can decrypt and ask the enclave. A verifier therefore
cannot produce an answer — they can only **request** one, and wait.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `requestId` | `str` | ✓ | `q-` + 12 hex of the EIP-712 hash of the signed Request, so one signature makes one question |
| `grantId` | `str` | ✓ | the capability it is made under |
| `vaultId` | `str` | ✓ | which document |
| `owner` | `addr` | ✓ | **whose inbox this lands in** |
| `asker` | `addr` | ✓ | who is waiting |
| `askerName` | `str` | ✓ | the grant's `verifierName`, copied |
| `questionSet` | `str` | ✓ | the grant's, copied |
| `questionHash` | `str` | ✓ | sha-256 of the exact question |
| `state` | `str` | ✓ | `pending`, then `answered` or `refused`. The schema also names `withdrawn`, which nothing writes |
| `askedAt` | `u64` | ✓ | ms, **as the asker signed it**. Refused if more than 10 minutes off |
| `decidedAt` | `u64` | ✓ | ms, `0` until decided |
| `accessId` | `str` | ✓ | the receipt, once answered |
| `question` | `str` | | verbatim |
| `askerSig` | `bytes` | | **EIP-712, signed before being told anything**, by the verifier's wallet or by `askerKey` |
| `askerKey` | `str` | | a browser key the verifier's wallet let sign for them, or empty |
| `askKeySig` | `bytes` | | the verifier's wallet over that key, which traces `askerSig` back to them: a `Session` when `askKeyDiesAt` is set, otherwise an `AskKey` (grantId, key, the grant's diesAt) |
| `askKeyDiesAt` | `u64` | | seconds, when the `Session` ends; `0` for an `AskKey` or with no key |

`$expiresAt`: 7 days, so the person who asked can still read what came back after the permission ends.
A question can no longer be answered once its permission has ended: the inbox hides it and `POST /api/answer`
returns 410.

`state` is a positive enum for the same reason as everywhere else: the network has no `NOT`, so
"not yet answered" is inexpressible and `pending` has to be written explicitly.

The queried fields are `owner` + `state` (the inbox), `grantId` (every question under one
permission, which the asker's page polls), `grantId` + `state` (how many are waiting, counted)
and `requestId` (one question).

---

## Who owns what, and who can write it

| Entity | `$owner` | Who authored it | How that is proven |
|---|---|---|---|
| `vault` | writing wallet | the data principal | `ownerSig`, EIP-712 `Seal` over the ciphertext hash and name. And the ciphertext is useless without their passphrase |
| `grant` | writing wallet | the data principal | `ownerSig`, EIP-712 over the exact terms, from their wallet or from `ownerKey` with `ownerKeySig` from their wallet |
| `request` | writing wallet | the verifier | `askerSig`, from their wallet, or from `askerKey` with `askKeySig` from their wallet |
| `access` | writing wallet | the data principal's device | `askerSig` carries the answering key's EIP-712 signature. The grant names that key, or the server checked the owner's `Delegation` for it, which the receipt does not keep |
| `refusal` | writing wallet | the data principal's device | the server checks the owner's signed `Answer`, with no answer in it, before writing. The refusal keeps no signature; the request it refers to carries the asker's |

**The writing wallet is a paymaster, not an author.** Browser wallets are on Sepolia, not Rabdi,
so the server pays every write — and verifies an EIP-712 signature recovers to the claimed
address before it does. It can pay for a record and cannot author one. A forged grant would
require a forged signature. Grant and question ids come from the signed messages, so those
signatures cannot be posted twice either.

**One wallet popup a week.** A browser asks its wallet once for a `Session`: the key it generated,
when it ends (at most 7 days, written out in UTC so the popup is readable), and the line "It cannot
move any funds". That key then signs the same typed messages the wallet would. The server checks
both signatures, and the records keep both, so a record signed by a browser key still traces to
a wallet.

The owner's browser does not take the paymaster's word for anything it pays to answer. Before
a question costs anything, it checks the owner's signature over the grant and the asker's over
the question, so a server that invented a question, or widened a topic, would get nothing
answered.

---

## Constraints these schemas are built against

| Limit | Value | Consequence here |
|---|---|---|
| attributes per entity | 32 (31 named) | largest entity is `access` at 21 |
| `str` | **128 bytes**, not characters | `fitStr()` truncates on a code-point boundary — `₹` costs 3 bytes, `मियाद` is 5 chars and 15 bytes |
| `bytes` | 128 KiB per column and per create | sets the maximum document size |
| indexed types | not `bytes` | ciphertext is unqueryable by construction |
| query page | 100 rows | all list reads cap at 100 |
| `MAX_LIFETIME` | 7,884,000 blocks ≈ 182.5 days | nothing outlives six months without a signed renewal |
| negation | **none** | every lifecycle state is a positive enum |
| removed in 1.0 | `bytes32` | `key` is used instead where needed |

System fields used: `$key`, `$expiresAt`, `$owner`, `$creator`.
