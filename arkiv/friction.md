# Friction

Everything here was hit while building AskOnly on Rabdi on 5–6 November 2026, against
`@arkiv-network/sdk@1.0.1`. Every number is measured. Where something cost real time I have
said how much and what the fix was, because a list of things that went smoothly would be
useless to you.

Short version: the SDK is good and the error messages are unusually helpful. The two things
that cost the most were a **chain-wide event firehose that is not documented as one**, and a
**silent inconsistency in reads from load-balanced RPC** — and only the first is Arkiv's.

---

## 1. `watchEntityEvents` is a chain-wide firehose, and nothing says so

**The single most expensive thing to get wrong, and it fails silently in the worst direction.**

`reader.watchEntityEvents({ onExpiryExtended })` has no schema filter, no owner filter and no
key filter. It is **every entity on the chain**. `.ownedBy()` and `.createdBy()` exist on the
*query* builder, which makes it natural to assume the subscription has them too. It does not.

Measured here, twice, on an unfiltered subscription:

| Window | Events seen | Belonging to us |
|---|---|---|
| 20 s | 8 | 0 |
| 24 s | 45 | 1 |

So on our second measurement, **44 of 45 extension events belonged to strangers.**

Why this is worse than an ordinary bug: AskOnly's whole thesis is that *extending* a permission
is a public act while letting it die is silent. The retention monitor is what proves it.
Unfiltered, it would report nine unrelated wallets' retention as if it were the data subject's —
which is not merely wrong output, it is a **false accusation**.

Our fix is in [`src/arkiv/watch.mjs`](../src/arkiv/watch.mjs): filter client-side against a known
owner/key set, count the drops, and **refuse to start unfiltered** rather than defaulting to
"show everything":

```js
if (ownerSet.size === 0 && keySet.size === 0) {
  throw new Error("watchExtensions refuses to run unfiltered: the subscription is " +
                  "chain-wide and would report strangers' extensions as yours.");
}
```

We report the drop count, because *44 dropped* is itself the evidence that the filter is
load-bearing. It is in `GET /api/retention`; no screen shows it.

**Suggestion:** an `owners` / `keys` / `schema` option on `watchEntityEvents` would remove a
whole class of silent misattribution. Failing that, one sentence in the docs saying the stream
is chain-wide would have saved us an hour and would save someone else a wrong demo.

Smaller related notes:
- `onExpiryExtended` is a **handler key**, not an event name — the event's own `type` is
  `"ExpiryExtended"`. Easy to search for the wrong string.
- Events carry `entityKey` and `owner` but **no schema tag**, so filtering by schema costs a
  lookup per event.
- **Natural expiry emits nothing at all.** That is exactly what we want and we build on it, but
  it is worth stating in the docs next to the extension event, since "no event" is a meaningful
  signal rather than an omission.

---

## 2. Writes need typed value tags, not just query predicates — 20 minutes

The docs and skills are emphatic that *query predicates* need `str()`, `addr()`, `u64()`. It is
less obvious that **`createEntity` values need them too**. Our first write failed with:

```
Column "owner": a addr column, but the value is a str. Write addr(...) around the value.
```

That error is genuinely excellent — it names the column, both types and the fix. Credit where
due; most SDKs would have thrown a decoding error three layers down.

What made it cost anything at all is that a **bare JS string is accepted for a `str` column**,
so partial tagging appears to work until the first non-string column. We now tag every value,
including strings, so the inconsistency cannot come back:

```js
{ vaultId: str(vaultId), owner: addr(owner), bytesLen: u64(BigInt(n)), cipher: bytes(buf) }
```

Note `bytes()` happily takes a `Uint8Array` as well as hex, which is not obvious from the type
name and is nicer than it needed to be.

---

## 3. `extendEntity` takes an object, and getting it wrong produced a *false pass*

```js
wallet.extendEntity(entityKey, expiration, txParams)        // wrong
wallet.extendEntity({ entityKey, expiration }, txParams)    // right
```

The positional form throws `InvalidExpiryError: expiration must be built with ExpirationTime`.

This is worth calling out beyond the signature itself. Our expiry test asserts "every operation
on a dead entity fails". With the wrong argument shape the extend call *did* fail — for the
wrong reason — and the test **passed while proving nothing**. A false proof is worse than a
missing one. The script now prints the reason beside each failure, so a pass for the wrong reason
shows. It does not check the reason in code.

---

## 4. Everything is public, and the access key is in the RPC URL

`rabdi({ accessKey })` path-encodes the key into the RPC URL. That is a tidy design, but it
means **any unscrubbed transport error stringifies your access key** into logs, terminals and
UI error toasts. We scrub every error that leaves the Arkiv layer:

```js
String(e?.shortMessage || e?.message || e)
  .replace(/ark_live_[A-Za-z0-9_-]+/g, "ark_live_<redacted>")
  .replace(/https?:\/\/[^\s)]+/g, "<rpc-redacted>")
```

Combined with "anyone can read any entity", this shaped the schema: **nothing from inside the
document is written to Arkiv except as ciphertext.** The document is AES-GCM-256 ciphertext
encrypted in the browser, and a verdict is yes, no or unknown. That is not the same as no personal
data: each question is stored word for word, and so are the reviewer's display name and the
document's label.

---

## 5. No `NOT`, no `!=` — and this is a schema-design constraint, not a query one

The network has no negation at all. That is a defensible choice for an indexed store, but it
propagates backwards into modelling: you cannot express "permissions that have not been spent".

So every lifecycle state has to be an **explicit enum you patch on transition**, never an
absence you negate. In AskOnly `grant.state` is `live | revoked`, plus `spent` for older grants
that carried a question count, written at the moment the last use is consumed:

```js
const set = { usesSpent: u64(next) };
if (BigInt(usesAllowed) > 0n && next >= BigInt(usesAllowed)) set.state = str("spent");
```

Worth putting in the data-modelling docs as a first-class rule rather than a query footnote —
it changes the schema, and discovering it late means a migration.

---

## 6. `str` is 128 **bytes**, not characters

Obvious in hindsight, and genuinely dangerous for an Indian product. `"मियाद"` is 5 characters
and 15 bytes; a question containing `₹` costs 3 bytes for that one glyph. A naive
`slice(0, 128)` can also cut a multi-byte character in half and produce invalid UTF-8.

We wrote `fitStr()` to truncate on a **code-point boundary** measured in encoded bytes. It would
be a kind addition to the SDK, since every app storing user text needs exactly this.

---

## 7. A malformed query throws — which is right, and worth knowing

`QueryError` is raised for a bad query rather than returning an empty result set. This is the
correct behaviour and we built on it (we let it throw rather than rendering "no data"), but it
is the opposite of what most query builders do, so it deserves a line in the docs.

The client-side predicate type checking is the best we have seen anywhere:

```
InvalidPredicateError: "subject" is a addr column, but the predicate asserts a str,
so it could never match. Write addr(...) around the value.
```

"so it could never match" is the part that turns an error into a lesson.

---

## 8. Reads cost no gas — which is a better feature than it sounds

We validated every query shape in this project against the live network **before funding
anything**, with a zero-balance wallet. For a hackathon under time pressure that is the
difference between finding a syntax error in minute three and finding it in hour six. Please
keep it, and please say it louder in the docs.

---

## 9. The faucet has no address field

`hub.arkiv.network/faucet` offers only "Connect wallet". Best practice — and what the official
`arkiv-first-write` skill recommends — is a dedicated development EOA generated server-side and
never held in a browser. But that EOA cannot be funded, because the faucet can only pay the
wallet it is connected to. You must either import a throwaway key into a browser wallet or
claim to a personal wallet and forward.

An address field, or a signed-message claim flow, would close that gap.

---

## 10. Documentation drift (minor, but it cost lookups)

- The docs sidebar still lists symbols removed in 1.0: `updateEntity`, `bytes32`, `payload`,
  `jsonToPayload`, `MimeType`, cursors, `ExpirationTime.permanent()`.
- The sidebar does **not** list `rabdi`, which is the chain helper you actually need.
- The repo README's sample `package.json` still pins `^0.9.0`, which is a different API.
- `createPublicClient` / `createWalletClient` come from **the Arkiv SDK, not from viem**, despite
  having viem's names. We read the `.d.ts` to be sure.
- Guidance on gas is contradictory: 1.0.1 is documented as adding 25% over estimate
  automatically and making the manual floor obsolete, while a working reference implementation
  on this machine still passes an explicit floor and succeeds. We kept the explicit floor —
  unused gas is refunded, a too-low value costs a failed write and a confusing revert — but we
  could not determine which is current.

Installing the official skills from `Arkiv-Network/skills` before writing a line was the single
highest-value thing we did, and it should be the first instruction in the quickstart.

---

## 11. Not Arkiv's fault, but it bit us: load-balanced RPC reads can disagree

Recording it because it is the same *class* of bug as #1 and someone will hit it here too.

On Sepolia (not Rabdi), two `eth_call`s issued back to back right after a write were served by
nodes at different heights. `mayAsk` returned `true` while `permittedSets` returned
`income=false` **in the same breath** — a UI showing both would have contradicted itself.

The fix generalises: **pin every group of reads that must agree to one block number**, and throw
if two pinned reads of the same fact still disagree rather than quietly picking one.

---

## What went right

- 2-second blocks make an expiry demo actually watchable. We showed a permission queryable at
  block 283073 and gone at 283075, live, in 17 seconds of wall time.
- `ExpirationTime.fromMinutes()` made a 90-second capability trivial to construct.
- The 128 KiB `bytes` limit is enough for an encrypted payslip, which let us
  drop a whole storage dependency and put the ciphertext in Arkiv itself — where it carries its
  own death block.
- Error messages are, with the exceptions above, the best part of the SDK.
- The chain being six days old was not a problem for us once. That is worth saying plainly.
