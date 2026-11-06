# AskOnly — build plan

**"Answer the question. Never send the file."**

ETHGlobal Mumbai 2026 · From Scratch · submission **Sat 7 Nov 09:00 IST** (target submit **08:00**)
Plan written 6 Nov 13:15 IST · **T-19h45m**

---

## 1. What it is, in one paragraph

You put a document into AskOnly. It encrypts in your browser; the ciphertext goes to Arkiv
carrying its own death block. A verifier — landlord, HR, lender — never receives the file. You
grant them a **capability**: one question-set, N uses, an expiry. They ask *"is monthly income
above ₹50,000?"* and get **YES** from a model running inside an Intel TDX enclave, plus a receipt
they must sign to see. They ask anything else and it is refused before it reaches your document.
When the grant expires, Arkiv stops answering for it and every operation on it fails — and because
Arkiv emits an event when someone *extends* a record but nothing when one dies, the absence of an
extension event is public proof nobody quietly kept it alive.

**Thesis:** you cannot prove you deleted data (Broadbent & Islam, TCC 2020 — certified deletion is
impossible with classical information). So deletion is the wrong primitive. **Non-collection is the
right one: you can't prove you deleted it, you can prove you never held it.**

---

## 2. The three decisions that define this build

### 2.1 Local-first, and literally no middle — *verified today*

0G's router enforces an **origin allowlist** on CORS preflight. Probed 6 Nov 13:10 IST:

| Origin | `OPTIONS /chat/completions` |
|---|---|
| `https://pc.0g.ai` | **204** |
| `http://localhost:5173` | **204** ← |
| `https://askonly.vercel.app` | **403** |

So the owner's browser **on localhost can call the enclave directly**. There is no relay process, no
server holding the 0G key, no operator who could read the extract. The previous design assumed a
browser could never reach 0G and inserted a local relay; the relay is unnecessary.

- The owner's 0G key is entered by the owner, kept in their browser on their own machine, and is
  **never sent anywhere but `router-api.0g.ai`**. AskOnly ships without a key.
- The **hosted demo** (for the judge-clickable link) cannot do this — the deployed origin is blocked.
  It therefore runs in **relay mode behind a permanent banner**: *"This hosted instance is a trusted
  operator. It holds a demo key and sees the extract. Run it locally and no one does."*
  Stating that is worth more than hiding it.

### 2.2 Text extract, not a photograph — *verified today*

| Model | healthy | verifiability | trust | TEE | modality |
|---|---|---|---|---|---|
| `glm-5.3` / 0G Foundation `0xD179…E503` | **true** | **TeeML** | **private** | TDX / dstack | **text→text** |
| `glm-5.3` / Baidu, Tencent | true | *none* | standard | — | — |
| `0gm-1.0-35b-a3b` `0xf4FB…B250` | **false** | TeeML | private | TDX / dstack | text+image→text |

The only image-capable TeeML model is **down**. So v1 sends a **minimal text extract**, never an image.
This does not weaken the "why AI" argument: the argument is that real Indian documents are *unsigned
and unstructured*, so there is no issuer signature to build a ZK circuit over. That is just as true of
typed payslip text as of a scan. **Local OCR is a stretch goal, not a claim.**

The same model being served by Baidu and Tencent with **no TEE at all** is a demo beat: `assertTeeML()`
refuses to run on a non-TeeML provider, and `private` trust mode returns 503 rather than silently
downgrading.

### 2.3 The receipt binds the *asker*, because 0G will not sign the answer — *verified today*

Eight signature/attestation paths, correct base URL, a live `chatcmpl` id: **all 404.**
`GET /v1/proxy/signature/{chatID}` does not exist on the Router. The original plan's EIP-191-signature
receipt **cannot be built.** What replaces it is narrower and real:

An `askonly.access` receipt binds `grantId · vaultId · questionHash · answerHash · requestId ·
provider · model · trustMode`, and **the verifier's own EIP-712 signature over all of it is what
releases the answer to their screen.** They cannot be told the answer without signing for having
asked.

0G can't prove the enclave said it. We can prove **the landlord asked it and was told** — which is
exactly the record DPDP Rules 2025 First Schedule Part B item 3 requires. Three signatures, two
parties, one network-enforced death:

```
principal signs the grant  →  verifier signs the receipt  →  Arkiv expiry kills the capability
```

Provider identity is verified by **address** against `GET /providers?model=` (which reports
`tee_attested`, `tee_type`, `tee_verifier`, `trust_mode`), not by a signature. `x_0g_trace.tee_verified`
is the **router's self-report** and is labelled as such in the UI.

---

## 3. Architecture

```
   OWNER'S OWN MACHINE (localhost)                    VERIFIER (anywhere)
   ┌──────────────────────────────┐                   ┌─────────────────────────┐
   │ browser                      │                   │ browser                 │
   │  • AES-GCM-256 encrypt       │                   │  • opens grant link     │
   │  • holds doc key + 0G key    │                   │  • connects wallet      │
   └───┬───────────────┬──────────┘                   └──────┬──────────────────┘
       │ ciphertext    │ extract (plaintext,                 │ asks a question
       │ (bytes)       │  in memory only)                    │
       ▼               ▼                                     ▼
   ┌────────────┐  ┌──────────────────┐            ┌───────────────────────────┐
   │   ARKIV    │  │  0G PRIVATE CPU  │            │  ENSv2 ETHRegistry        │
   │  (Rabdi)   │  │  glm-5.3 TeeML   │            │  0xd4ebcb…a8b4 (Sepolia)  │
   │            │  │  Intel TDX/dstack│            │  hasRoles(uint256,        │
   │ vault.ciph │  │  trust=private   │            │    uint256, address)      │
   │   = bytes, │  └────────┬─────────┘            └───────────┬───────────────┘
   │   expires  │           │ yes/no + band                   │ role bit = question-set
   │ grant      │           │ + requestId + provider          ▼
   │   $expires │           ▼                        ┌───────────────────────┐
   │   IS the   │  ┌──────────────────┐              │  AskOnlyGate.sol      │
   │   permission│ │ access receipt   │◄─────────────│  reverts unless the   │
   │ access[]   │  │ + EIP-712 sig of │   authorize  │  verifier holds the   │
   └────────────┘  │   the VERIFIER   │              │  role for that set    │
                   └──────────────────┘              └───────────────────────┘
```

**Each layer does only what it alone can do:**

| Layer | Role | Why nothing else works |
|---|---|---|
| Arkiv `bytes` | the encrypted document | the ciphertext itself carries a death block, so the data structurally expires — not just the permission |
| Arkiv entity | the capability + the access log | expiry is *enforced by the network*, and extension is *publicly observable* |
| 0G PC | the only reader, inside TDX | `private` routes only to TeeML providers and 503s rather than downgrading |
| ENSv2 | *who* may ask *what* | an on-chain role bitmap is the authorization, not a text record |

---

## 4. Hard technical facts to build against (all verified, do not re-derive)

### Arkiv — Rabdi
- Chain **7794095**, 2s blocks, gas token **tGLM**. SDK **`@arkiv-network/sdk` ^1.0.1**, `viem` is a
  **peer dep, not installed for you**. Node ≥22.10 (have 25.5).
- `rabdi({ accessKey })` encodes the key into the RPC URL ⇒ `http()` takes **no argument**, and
  **every error must be scrubbed or it leaks the key.**
- Limits: **32 attributes** (31 named), `str` = **128 BYTES not chars**, `bytes` = **128 KiB per
  column and per create/patch**, query page **100**, `MAX_LIFETIME` **7,884,000 blocks ≈ 182.5 days**.
- Types `bool i32 u64 u256 dec str addr key bytes`. **`bytes32` is removed → use `key`.**
- **`!=` and `NOT` do not exist.** Every filter must be positive ⇒ model state as an explicit enum
  (`live | spent | revoked | expired`), never as the absence of a value.
- Query: `and/or/eq/gt/gte/lt/lte/between/exists/startsWith`, **typed literals mandatory**
  (`str('x')`, `u64(1n)`, `addr(a)`); a bare number is `i32`. A bad query **throws `QueryError`,
  it does not return empty.** `bytes` can never be indexed or filtered.
- Read values as `row.col.value`; system fields bare (`$key`, `$expiresAt`, `$creator`).
- `expiration` is **required** on create. `ExpirationTime.fromMinutes/fromHours/fromDays`.
  **`permanent()` and `fromYears()` are gone.** `updateEntity` → `patchEntity(schema, key, {set, unset})`.
- 🔴 **`watchEntityEvents` is a CHAIN-WIDE FIREHOSE** — no schema/owner/key filter. Measured 61
  `onExpiryExtended` events in ~4 min from 9 unrelated wallets. **Filter client-side by owner or the
  demo fills with strangers' retention.** Natural expiry emits **nothing**; only `extendEntity` emits.
- Reads cost **no gas** — validate every query shape before funding anything.
- Writing wallet already funded ~9.99 tGLM: **`0x4CA8176777D44B76235684b63334088C618994e4`**.
  Faucet `hub.arkiv.network/faucet` has **no address field** — connect-wallet only.
- Pre-submission: run **`check_submission`** on the Arkiv MCP Mumbai profile `https://mcp.arkiv.network/mumbai`
  (**verified alive 6 Nov 13:20 IST** - `arkiv-mumbai` 2.1.0, protocol 2025-06-18; it is POST-only, so a
  GET returns 405 and that is not an outage). Call it over plain HTTP, no client config needed.

### 0G
- Base `https://router-api.0g.ai/v1` (**already includes `/v1`** — do not append it again).
- Model **`glm-5.3`**, pin provider **`0xD179F4526064846dE9a9E9D93683AF75CB72E503`**.
  Header `X-0G-Provider-Trust-Mode: private`. `response_format: {type:"json_object"}`, `temperature: 0`.
- **`max_tokens` ≥ 1500** — glm-5.3 emits reasoning tokens first and returns an **empty string** below
  that, which a naive parser turns into a false answer. This is a correctness bug, not a quality one.
- Measured on a real AskOnly prompt: **5.3 s, $0.000685/call**, `completion 105 / reasoning 85`.
- Receipt fields come from `x_0g_trace`: `provider`, `request_id`; plus top-level `id` (chatcmpl).
- `assertTeeML()` must refuse any provider whose `verifiability !== "TeeML"`. Only ~7 of 123 router
  models carry the field at all, and **TeeML (model in enclave) ≠ TeeTLS (transport only)**.

### ENSv2 — Sepolia
- **`ETHRegistry` = `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4`** (the live one).
- `hasRoles(uint256 anyId, uint256 roleBitmap, address account)` — 🔴 **first arg is `uint256`, NOT
  `bytes32`.** With `bytes32` it reverts and the revert *looks like a permissions failure*.
- 🔴 **A nybble is a BOOLEAN, not a 0–15 level.** `EnhancedAccessControl` validates every bitmap
  against `ALL_ROLES = 0x1111…1111` (64 ones) and reverts `EACInvalidRoleBitmap` if any bit outside a
  nybble's low bit is set. `1 << 40` is legal; **`0xF << 40` is rejected.** N question-sets = N nybbles.
  ENS occupies nybbles 0–6, 8, 9, 30, 31; **7 and 10–29 are free.**
- Admin counterpart is `role << 128`. Label → `BigInt(keccak256(toHex(label)))` (labelhash of **one**
  label, not a namehash). `labelId = 0` is the EAC `ROOT_RESOURCE`.
- `MockENSRegistry` must replicate the `ALL_ROLES` validation so tests cannot pass on bitmaps the real
  registry rejects.

**Question-sets → role bits** (free nybbles, one boolean each):

| Set | Role bit | May ask |
|---|---|---|
| `income` | `1 << 40` | is monthly income above a threshold; coarse band |
| `identity` | `1 << 44` | does the name/DOB on the document match a given value |
| `tenancy` | `1 << 48` | is there an active tenancy; is rent paid to date |
| `employment` | `1 << 52` | is the holder employed; is employment longer than N months |

### Sepolia
Live, block 12,075,131, chain **11155111**. Swarm upload gateway still **405**,
`SWARM_POSTAGE_BATCH` still empty ⇒ **Swarm's $500 is a stretch that needs a batch ID from the booth.**

---

## 5. Track qualification — all three central, none bolted on

**Picks: Arkiv from-scratch $4,000 (+Swarm $500 free) · 0G Private Computer $5,000 · ENSv2 $7,000 = $16,500.**

| Track | Why it is load-bearing | Must ship |
|---|---|---|
| **Arkiv** | The capability *is* an Arkiv entity whose `$expiresAt` is the permission. Expiry-as-evidence is the thesis. Remove Arkiv and the permission becomes a promise in a database. | `friction.md` · `reach.md` · `why-arkiv.md` · `how-you-use-arkiv.md` (**25% each**) · `schema.md` · README with **writing wallet + one judge-runnable query** · OSS licence · **AI-use disclosure** |
| **0G** | The enclave is the *only* reader of the document. "AI is the product" — without it there is nothing to ask. Visible `request_id` per answer. | consumer-grade app, visible request IDs, one sentence on what breaks without 0G, a reason to come back tomorrow |
| **ENSv2** | The question-set a verifier may ask **is** an on-chain role on your name. Revoking is an ENS role revoke. A contract reads `hasRoles` in the hot path. | functional demo, **no hard-coded values**, live demo link, ENS central not cosmetic |

**The ENS differentiator:** "issue subnames with permissions" is *the* obvious ENSv2 demo and will be
built by others. Ours is the **refuse → grant → succeed** loop: the same question is refused, a role is
granted on-chain, the same question now answers — the authorization is visibly the ENS role.

---

## 6. What I must not claim (say the boundary before a judge finds it)

- ❌ "the enclave refuses to decrypt after expiry" — **our policy code is not in the enclave.**
  Enforcement is at the client and the verifier. Say where it lives.
- ❌ "the data is cryptographically erased" — Arkiv's docs do **not** claim bytes are pruned from
  history. Expiry means queries stop returning it and operations fail. That is what we say.
- ❌ "the law mandates immutability" — it does not. The obligation exists; the integrity guarantee
  doesn't. *That* is the hole we fill.
- ❌ "we are a registered Consent Manager" — Part A item 4 requires **₹2 crore net worth.** We are the
  reference implementation a registrant would run.
- ❌ "audited" (ENSv2's audit status is unconfirmed) · ❌ that the Data Protection Board exists yet.
- ✅ **Expiry kills the capability, not knowledge.** A verifier told "YES" still knows "YES". AskOnly
  shrinks what is disclosed to one bit and makes every bit accountable. Nothing makes knowledge revocable.
- ✅ The TEE trust boundary is real but not absolute — Intel TDX, the dstack image, 0G's gateway, and
  TEE.fail (Oct 2025). Name it out loud. VEIL VPN won three first prizes with exactly this boundary stated plainly.

**Pre-empt the killer question** — *"a signed receipt proves the key holder signed a claim, not that the
data is absent."* Correct, and that is exactly why AskOnly issues **no deletion receipts**. Absence is
structural: the storage layer refuses the query, and the only path to the plaintext was a capability
that no longer exists.

---

## 7. UI — "Court Paper", decided once

House style is Danish's own site: **engineering-paper neo-brutalism — warm paper, ink, one accent,
pressed rather than floating.** Tokens are fixed and not re-litigated per screen.

- **Ground/ink:** `--paper #F7F3EA` · `--paper-2 #F0E9DB` · `--card #FFF` · `--ink #121212` ·
  `--ink-2 #3D3A35` · `--ink-3 #6B655C` · `--rule #E4DCCC` · `--grid rgba(18,18,18,.045)`
- **Four stamp inks, desaturated on purpose:** amber `#F59E0B` (action) · seal `#1E6B4F` (valid) ·
  oxide `#B23A2F` (blocked) · indigo `#27418C` (informational).
  Track identity: **ENS → indigo · 0G → ink · Arkiv → seal.**
- **Type, all self-hosted variable woff2:** **Geist** (UI + body, body is **15px** — "this is a
  console") · **Geist Mono** (every number, hash, address, label, with `tabular-nums` +
  `slashed-zero` so `0G` never reads as O-G) · **Newsreader** (display **only**). **No Inter.**
- **Elevation is a stamp, not a blur:** `--press: 2px 2px 0 var(--ink)`. Radii `5/8/12px` —
  **nothing is 16px+ except a pill.**
- **Motion:** `--ease cubic-bezier(.2,.8,.25,1)` · `--thunk cubic-bezier(.34,1.42,.64,1)` (a stamp
  hitting paper) · `--d1 110ms --d2 200ms --d3 380ms`. `prefers-reduced-motion` → 0.01ms.
- Press behaviour: hover lifts 1px and deepens the shadow; **active presses *into* the page
  `translate(2px,2px)` with the shadow to zero.** That press is the personality of the system.

**Never:** indigo→purple gradients · Inter · uniform 16px+ radii · glassmorphism · emoji as bullets or
headings · three identical feature cards · fade-up-on-scroll that hides content · uppercase+tracking on
headings (only the 11px mono label) · "Build the future" copy.

**Motion discipline (from the Apple fluid-interface rules):** springs not keyframes for anything
grabbable; animate from the *presentation* value so an interrupted transition never jumps; feedback on
pointer-**down**, not release; the countdown and the answer-landing are the only two places that get
bounce, because both are momentum-carrying events. **Everything is present on load — no scroll-reveal.**

### Screens
1. **Landing** — the argument, animated: deletion is unprovable → so stop handing it over. One live
   widget: a document that *doesn't* move while a question crosses to the enclave and a single bit
   comes back. The tear-line receipt stamps in with `--thunk`.
2. **Vault (owner)** — add a document, see its ciphertext size and its death block, local-only badge.
3. **Grant (owner)** — pick question-set, uses, expiry; sign; get a link. Shows the ENS role being
   required, not a checkbox.
4. **Ask (verifier)** — the permitted question, the refusal path, the enclave wait (5s, honest not
   hidden), the answer, the receipt they sign, the request id and provider address.
5. **Ledger** — "who asked about me", the live countdown, and the retention monitor (owner-filtered).

---

## 8. Clock — P0→P8, IST

| Phase | Window | Deliverable | Gate to pass before moving on |
|---|---|---|---|
| **P0** | 13:15–14:00 | deps, `.env`, preflight: Arkiv balance + a real ENS read + a real 0G call | all three green |
| **P1** | 14:00–15:30 | Arkiv layer: 4 schemas, guarded write, 6 queries, expiry, owner-filtered watch | a real entity written + read back + one expiry observed |
| **P2** | 15:30–17:00 | `AskOnlyGate.sol` + `MockENSRegistry` + tests + Sepolia deploy + `deployments.sepolia.json` | tests green, `hasRoles` answered from the **live** registry |
| **P3** | 17:00–19:00 | enclave client: `assertTeeML`, private mode, JSON contract, receipt harvest, refusal path | YES on a permitted question, refusal on an unpermitted one |
| **P4** | 19:00–22:30 | design tokens + landing + vault + grant + ask + ledger | keyboard-operable, reduced-motion clean, zero hard-coded addresses |
| **P5** | 22:30–00:30 | the loop end-to-end, twice, on a cold start | grant → ask → refuse → expire → no-extension proof |
| **P6** | 00:30–02:00 | the four graded Arkiv files + `schema.md` + README + AI disclosure + MIT | a stranger can run the judge query from the README alone |
| **P7** | 02:00–04:00 | hosted demo w/ operator banner, demo script, <3 min video | link opens on a clean browser |
| **P8** | 04:00–06:30 | buffer · `check_submission` on the Arkiv MCP Mumbai profile · submit | **submit by 08:00** |

**Commit continuously.** ETHGlobal grades commit history: *"Any repositories with single commits of
large files without proper history will be default assumed to be unqualified."* One commit per
meaningful step, honest messages.

---

## 9. Demo — 4 minutes, with a refusal and a death

1. Add a payslip. It encrypts in the browser. **Nothing readable leaves** — show the ciphertext bytes
   and its death block in Arkiv. *(Not Swarm. v1 ciphertext lives in Arkiv `bytes`.)*
2. Grant `landlord.eth` the **income** set: 3 uses, 7 days. Sign it.
3. Landlord opens the link, connects, asks *"is monthly income above ₹50,000?"* → **YES**, with the
   0G `request_id` and provider `0xD179…E503` shown, and the provider's TDX/dstack attestation
   fetched live from `/providers`. They sign the receipt to see the answer.
4. Landlord asks *"what is their exact salary?"* → **refused**, no ENS role for that set. Then grant
   the role on-chain and watch the same question start answering. **That is the ENS beat.**
5. Re-issue with a **2-minute** expiry. Let the countdown run while you talk.
6. Expiry passes. The link dies — the Arkiv query returns nothing and every operation on the entity
   fails. Show the retention monitor: **no extension event was ever emitted** (owner-filtered, so the
   board is ours and not 15 strangers').
7. **Closing:** *"He never had the document. There is nothing to delete, because he never held it."*

---

## 10. Risks, ranked

| Risk | Mitigation |
|---|---|
| Arkiv is 6 days old; rough edges | every failure goes straight into `friction.md`, which is **25% of the Arkiv score**. Friction is an asset here. |
| `watchEntityEvents` firehose ruins the climax | owner-filter from the first line; never demo unfiltered |
| glm-5.3 returns empty under `max_tokens` | floor at 1500 and **fail closed** — an empty completion is an error, never an answer |
| the only image-capable TeeML model is down | v1 is text-extract only; OCR is a stretch, never a claim |
| hosted origin blocked by 0G | relay mode + permanent operator banner; local run is the real guarantee |
| 19h and three integrations | P0 gates each integration with a live call before any feature code is written |
| Swarm $500 | only if the core loop is green by ~02:00, and only with a batch ID from the booth |

---

## 11. Open questions for the booths (free, high leverage)

- **0G:** is there a hosted `tapp-server` I can point `tapp-cli` at? If yes, policy code *can* live in
  the enclave and the central claim gets strictly stronger. Also: when does `0gm-1.0-35b-a3b` come back?
- **Arkiv/Swarm:** a postage batch ID and a Bee endpoint we can upload through — the prize text says
  "the wallet that bought it **(or who gave you the batch)**", so sponsors hand them out.
- **ENS:** is `UserRegistry.initialize` on Sepolia the `Grant[]` form (selector `0x37cb53a8`)?
