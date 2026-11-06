# Why Arkiv

Short answer: **Arkiv is the only data layer we found where a record ceasing to exist is a
property of the network rather than a promise by its operator — and where keeping a record
alive leaves a public trace that letting it die does not.**

AskOnly is built on that asymmetry. Remove Arkiv and the product does not get slower or more
expensive; it stops being able to make its central claim.

---

## 1. The problem Arkiv is solving for us

You cannot prove you deleted data.

That is not rhetoric. Broadbent and Islam (TCC 2020) proved certified deletion is impossible
using classical information, because classical ciphertexts can be copied — certified deletion
requires quantum encodings. Cooper et al. (37 authors, including Google DeepMind, Microsoft
Research, Stanford and Cornell) found there is no way to cleanly identify and delete a specific
piece of information from a model's parameters. And what industry actually ships as *proof of
deletion* is NIST SP 800-88r2 §4.6: a certificate listing the **name, job title and phone
number** of the person who says they did it.

Meanwhile India's DPDP Act §8(7) requires erasure on consent withdrawal, and the DPDP Rules 2025
require a consent manager to keep a record of **every sharing event**, machine-readable, for
seven years — while being unable to read the data it brokers (First Schedule, Part B, item 2).

So the obligation to stop holding data is real and enforceable, and the ability to demonstrate
compliance does not exist. Every system in this space answers "is it gone?" with a database row
that says `deleted_at`, maintained by exactly the party it would incriminate.

**Our answer is to stop asking whether something was deleted and make non-collection
structural.** For that we need a store where expiry is enforced by the network and where
retention is observable. That is Arkiv.

---

## 2. What Arkiv does that a database with `expires_at` cannot

A Postgres row with an `expires_at` column is a **promise**: something has to run, something has
to honour it, and the party that benefits from ignoring it is the party that operates it. A
cron job that quietly stops running leaves no evidence.

An Arkiv entity's expiry is different in kind. From the docs, verbatim: *"From that block on,
queries don't return it and every operation on it fails."*

We did not take that on faith. Measured on Rabdi, live, in
[`scripts/arkiv-expiry.mjs`](../scripts/arkiv-expiry.mjs):

```
block 283073  QUERYABLE   2 blocks to live
block 283075  GONE        past death block

Trying to use the dead permission:
  ok read it by id    failed: not returned by any query
  ok patch its state  failed: reverted. Reason: no entity 0x32b3d3c1…0ecde5 —
                      it may have been deleted, or have expired
  ok extend its life  failed: no entity
```

Seventeen seconds of wall time, and the capability stops existing as far as the network is
concerned. Nobody ran anything. Nobody decided. **There is no revocation step to forget.**

---

## 3. The part that is genuinely unique: silence versus signature

This is the property the whole product rests on, and we have not found it anywhere else.

- **Arkiv emits an event when an entity's life is extended** (`ExpiryExtended`, surfaced as the
  `onExpiryExtended` handler).
- **Arkiv emits nothing at all when an entity simply expires.**

Read those together and the burden of proof inverts. Letting a permission die is *silent and
free*. Keeping one alive is a **signed, timestamped, publicly observable on-chain act**.

In every other consent system, retention is the default and deletion is the thing you must
evidence — which is impossible. Here, **deletion is the default and retention is the thing you
must explain.** That is the sentence this project exists to be able to say.

Both halves are measured, not asserted
([`scripts/arkiv-retention.mjs`](../scripts/arkiv-retention.mjs)):

```
[2] quietly buy it 7 more days
    extended to block 585512
[3] EXTENSION OBSERVED
      entity 0xcb6b51b4…03774b   new death block 585512
      tx     0xb6f2a093…4f3565
```

and for a permission allowed to die:

```
  belonging to THIS permission : 0
  No extension event was emitted for this permission. It was allowed to die.
```

`MAX_LIFETIME` — 7,884,000 blocks, about 182.5 days — reinforces it rather than limiting us.
**Nothing on Arkiv can outlive six months without a deliberate, publicly visible renewal.** For
a consent layer that is not a ceiling, it is the feature: consent that nobody re-affirms
expires, and re-affirming it is on the record.

---

## 4. Why the document itself lives in Arkiv

We originally planned to put the encrypted document in Swarm and keep only the capability in
Arkiv. We moved the ciphertext into Arkiv `bytes` instead, and it made the story stronger.

A `bytes` column holds 128 KiB per create, which comfortably fits a compressed encrypted
payslip. Because it is an ordinary Arkiv entity, **the ciphertext carries its own death block**.
So the data structurally expires, not merely the permission to ask about it. A storage layer
that refuses to return the bytes is a much better answer to "is it still there?" than any
retention policy.

It also removed an entire dependency, which on a 19-hour clock is its own argument.

---

## 5. Why not the alternatives

| Alternative | Why it does not work here |
|---|---|
| **Postgres / any operator-run DB** | Expiry is a promise by the party with the incentive to break it. No public evidence either way. |
| **IPFS** | Content-addressed and permanent by design; "unpin" is a request to one operator and proves nothing. The opposite of what we need. |
| **Swarm** | Good durable storage, and we still want it for long-lived receipts — but its postage model is about *paying to persist*, not about enforced expiry, and it emits no retention signal. Also: no public upload gateway (`POST /bzz` → 405) and no testnet faucet, so it costs hours we did not have. |
| **An L1/L2 contract with a TTL** | You can store an expiry, but the data stays in state and in history forever, and nothing stops a read. You would be writing the same promise, more expensively. |
| **Ceramic / EAS** | Attestations and revocations are *claims about* data. Revoking an attestation does not make a record stop being queryable. |

The distinction that matters: every one of these can record **that something expired**. Only
Arkiv makes the expiry *the thing that happens to the record*.

---

## 6. What we deliberately kept OFF Arkiv

Everything readable on Arkiv is public — *"anyone can write and read entities with any attribute
names"*. So the question of what we did **not** put there is as much a design decision as what we did.

| Kept off | Where it lives instead | Why |
|---|---|---|
| **The passphrase** | the owner's device, in memory, for one operation | It is the only thing between a public ciphertext and the document. It is never transmitted anywhere, including to our own server. |
| **The document key** | derived in the browser, never persisted | PBKDF2 at 210,000 iterations from the passphrase. There is no key to store, so there is no key to leak. |
| **The plaintext** | nowhere | It exists in the owner's tab for the duration of one answer. It is never written to disk, never logged, never sent to our server. |
| **The whole document, even to the enclave** | only the lines bearing on the question | Measured: 4 of 12 lines. The employer, PAN, account number and address never entered the enclave at all. |
| **Any personal data at all** | — | What is indexed on Arkiv is hashes, addresses, enums, counts and block numbers. There is no name, no figure and no identifier of a person in any entity. |
| **The 0G API key** | the owner's browser: their own, or the one in `.env` on the machine running AskOnly, which `GET /api/zerog/key` hands only to a page on that machine | The browser calls the enclave itself, so no question and no line of the document passes through our server. A key only the server could use would force every answer through it. |

The ciphertext itself **is** on Arkiv, deliberately, because a `bytes` column carries a death block
and that makes the document structurally expire rather than merely be marked deleted. That is a
considered trade: the bytes are public but meaningless, and in exchange they inherit enforced expiry.

---

## 7. The limits we will not overstate

We would rather state these than have a judge find them.

- **Arkiv's docs do not claim bytes are pruned from history, so neither do we.** Expiry means
  queries stop returning the entity and operations on it fail. We never say "cryptographically
  erased". Our defence against historical bytes is that they are AES-GCM-256 ciphertext
  encrypted in the owner's browser with a passphrase that never left it.
- **Everything readable on Arkiv is public.** That is why no personal data is written: only
  hashes, addresses, enums, and block numbers.
- **Expiry kills the capability, not knowledge.** A landlord who was told "yes" still knows
  "yes". AskOnly shrinks what is disclosed to a single bit and makes every bit accountable. It
  does not make knowledge revocable; nothing can.
- **The retention monitor is an observation over a window**, not a proof of absence for all
  time. We say so on the screen that shows it.

---

## 8. The one-line version

Arkiv is the only store we found where **a record stopping existing is something the network
does, and keeping one alive is something you have to sign for**. AskOnly turns that single
asymmetry into a consent layer: the permission to ask about your document is an entity whose
expiry *is* the permission, and the absence of an extension event is the closest thing anyone
has to evidence that nobody quietly kept it.
