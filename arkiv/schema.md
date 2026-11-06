# Schema

Four entities on Arkiv Rabdi (chain `7794095`), defined in
[`src/arkiv/schema.mjs`](../src/arkiv/schema.mjs) with `@arkiv-network/sdk@1.0.1`.

Namespace: `askonly.*`. Writing wallet: `0x4CA8176777D44B76235684b63334088C618994e4`.

**Nothing in any of these entities is personal data.** Everything readable on Arkiv is public,
so the only document content stored anywhere is AES-GCM-256 ciphertext encrypted in the owner's
browser. What is indexed is hashes, addresses, enums, counts and block numbers.

---

## `askonly.vault` — an encrypted document

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `vaultId` | `str` | ✓ | `v-` + 8 hex, the handle used everywhere |
| `owner` | `addr` | ✓ | the data principal |
| `docKind` | `str` | ✓ | `payslip` `bank` `rent` `identity` `other` |
| `state` | `str` | ✓ | `live` `retired` |
| `sha256` | `str` | ✓ | sha-256 of the **plaintext**, so the owner can prove which document this was |
| `bytesLen` | `u64` | ✓ | ciphertext length |
| `createdAt` | `u64` | ✓ | ms since epoch |
| `label` | `str` | | owner-facing name, e.g. `Payslip — Oct 2026` |
| `iv` | `str` | | base64 AES-GCM nonce |
| `cipher` | `bytes` | | the document. Encrypted in the browser, never decrypted server-side |

`$expiresAt`: owner's choice, default 180 days.
`cipher` is capped by Arkiv at **128 KiB per create**, which fits a compressed encrypted payslip.
A `bytes` column can never be indexed, filtered or sorted — so documents cannot be queried by
content even by accident.

---

## `askonly.grant` — the capability

**The entity whose expiry *is* the permission.** There is no `isActive` flag and no revocation
job; past `$expiresAt` the network stops returning it and every operation on it fails.

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `grantId` | `str` | ✓ | `g-` + 8 hex |
| `vaultId` | `str` | ✓ | joins to the document |
| `owner` | `addr` | ✓ | who granted it |
| `verifier` | `addr` | ✓ | who may ask |
| `verifierName` | `str` | ✓ | the ENS name, e.g. `landlord.eth` |
| `questionSet` | `str` | ✓ | `income` `identity` `tenancy` `employment` |
| `state` | `str` | ✓ | `live` `spent` `revoked` |
| `usesAllowed` | `u64` | ✓ | how many times it may be used |
| `usesSpent` | `u64` | ✓ | how many times it has been |
| `issuedAt` | `u64` | ✓ | ms |
| `diesAt` | `u64` | ✓ | ms, mirrors `$expiresAt` for display and sorting |
| `roleBit` | `u256` | | the ENSv2 EAC role the verifier must hold |
| `labelId` | `u256` | | the ENS resource the role is checked against |
| `threshold` | `str` | | the figure inside the question — never the document's |
| `note` | `str` | | the exact question the owner authorised, verbatim |
| `ownerSig` | `bytes` | | EIP-712 signature of the principal over the grant terms |

`$expiresAt`: **required at creation** and is the whole permission.
`state` is an explicit enum because the network has **no `NOT` and no `!=`** — "not yet spent"
cannot be expressed, so `spent` is written at the moment the last use is consumed.

---

## `askonly.access` — the receipt

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `accessId` | `str` | ✓ | `a-` + 8 hex |
| `grantId` | `str` | ✓ | which capability authorised it |
| `vaultId` | `str` | ✓ | which document |
| `owner` | `addr` | ✓ | lets the principal run "who asked about me" |
| `asker` | `addr` | ✓ | who asked |
| `askerName` | `str` | ✓ | their ENS name |
| `questionHash` | `str` | ✓ | sha-256 of the exact canonical question |
| `answer` | `str` | ✓ | `yes` `no` `unknown` |
| `answerHash` | `str` | ✓ | sha-256 of the enclave's exact reply |
| `requestId` | `str` | ✓ | 0G `x_0g_trace.request_id` |
| `provider` | `addr` | ✓ | the enclave address that answered |
| `model` | `str` | ✓ | e.g. `glm-5.3` |
| `trustMode` | `str` | ✓ | `private` |
| `verification` | `str` | ✓ | `provider-address` or `request-id-only` — **never `signature`** |
| `at` | `u64` | ✓ | ms |
| `question` | `str` | | the question verbatim |
| `band` | `str` | | a coarse band where the set allows one. Never an exact figure |
| `teeType` | `str` | | e.g. `TDX/dstack`, as reported by `/providers` |
| `latencyMs` | `u64` | | how long the enclave took |
| `askerSig` | `bytes` | | **EIP-712 signature of the verifier.** The answer is not released to their screen without it |

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
| `reason` | `str` | ✓ | `no-ens-role` `out-of-set` `uses-exhausted` `expired` `revoked` |
| `at` | `u64` | ✓ | ms |
| `question` | `str` | | verbatim |
| `detail` | `str` | | human-readable explanation |

`$expiresAt`: 180 days.

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
