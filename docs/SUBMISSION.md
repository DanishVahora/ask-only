# AskOnly — ETHGlobal Mumbai 2026 submission copy

Tracks: **Arkiv — Build on Arkiv (from scratch)** · **0G — Build with 0G Private Computer** ·
**ENSv2 — Best Use of ENSv2**. Built from scratch at Mumbai. MIT.

---

## 1. Tagline

> Answer the question. Never send the file — the permission is killed by the network, not a promise.

*(98 characters, limit 100.)*

## 2. Short description

> Your landlord needs one bit, not your payslip. AskOnly grants a verifier a capability to ask one
> question about a document they never receive, answered by a model inside an Intel TDX enclave.
> The permission is an Arkiv entity whose expiry the network enforces.

*(260 characters, limit 280.)*

---

## 3. Full description

A tenant in Mumbai is asked for a payslip to rent a flat. The landlord wants to know one thing:
can this person pay ₹25,000 a month. What he receives is a PDF carrying the tenant's employer,
employee ID, PAN, bank account number, home address, designation, joining date and exact salary.
It goes into a WhatsApp thread, a broker's laptop and an email archive. One bit was wanted and a
whole document was surrendered, because handing over the document is the only mechanism that
exists. The same trade happens at HR verification, NBFC loan desks, school admissions and gig
onboarding.

The usual repair is a deletion promise, and that repair is not available. Broadbent and Islam
(TCC 2020) proved certified deletion is impossible with classical information, because classical
ciphertexts can be copied. What the industry actually ships as *proof of deletion* is NIST SP
800-88r2 §4.6: a certificate listing the name, job title and phone number of the person who says
they did it. India's DPDP Act §8(7) makes erasure on withdrawal enforceable to ₹250 crore, and the
ability to demonstrate it does not exist.

So deletion is the wrong primitive. **Non-collection is the right one: you cannot prove you
deleted it, you can prove you never held it.** AskOnly is built entirely around that swap.

**How it works, as two parties with two wallets.** The owner connects a wallet; their address is
their identity. A document is encrypted in their browser — AES-GCM-256, key derived by PBKDF2 at
210,000 iterations from a passphrase that never leaves the page — and the ciphertext is written to
Arkiv as an entity carrying its own death block. The owner signs one EIP-712 **grant**: this reviewer,
until this time, and this key in my browser may answer them. That is the only decision the owner makes.
A reviewer connects their own wallet and signs once, letting a key in their browser sign EIP-712
**requests** under that one permission, so each question lands as `askonly.request state=pending`
with no further popup. Because only the owner's device holds the passphrase, **only the owner's
browser can answer**, and it does so by itself: it decrypts locally, sends the fewest lines that can settle
the question to a `glm-5.3` enclave on 0G Private Compute, widens only if those cannot, and signs the
answer back with the key the grant named. The reviewer never holds a key, a passphrase or a document. The server pays Arkiv gas and does nothing
else: it runs `verifyTypedData` on every grant, request and answer before it writes, so **the
operator pays for a transaction and cannot author one.** The owner's browser checks the same
signatures before it pays to answer, so a server that invents a question gets nothing answered.

Three sponsors, three jobs nothing else does. **Arkiv** holds the capability, and the capability's
`$expiresAt` *is* the permission — there is no `isActive` flag to forget and no revocation job to
stop running. **0G** is the only reader: a model in an Intel TDX enclave is the first universal
adapter from unsigned, unstructured Indian paper to one bit, which is why ZK credentials never
reached payslips. **ENSv2** decides who may ask what: the question set is a role bitmap on a name,
checked by `hasRoles` in the hot path, so revoking a permission is revoking an ENS role.

What is genuinely novel is the asymmetry underneath. Arkiv emits an event when an entity's life is
**extended** and emits nothing at all when one **expires**. Letting a permission die is silent and
free; keeping one alive is a signed, timestamped, publicly observable act. Everywhere else,
retention is the default and deletion is the thing you must evidence — impossibly. Here deletion is
the default and **retention is the thing you have to explain.**

*(~554 words.)*

---

## 4. Per-track blurbs

### 4.1 Arkiv — Build on Arkiv (from scratch)

AskOnly's central object is an Arkiv entity whose **expiry is the permission itself**, not a field
describing one. `askonly.grant` is created with a required `$expiresAt` and has no `isActive`
boolean and no revocation job: past the death block the network stops returning it and every
operation on it fails. Measured live on Rabdi (chain 7794095) in `scripts/arkiv-expiry.mjs`: block
283073 `QUERYABLE`, block 283075 `GONE`, 17 seconds of wall time — read by id fails, `patchEntity`
reverts with *"no entity … it may have been deleted, or have expired"*, extend fails. The
verifier-facing `GET /api/grant` renders Arkiv's 404 as the expiry rather than as an error.

The property the product rests on: **extension emits `ExpiryExtended`; natural death emits
nothing.** Retention is a public on-chain act; letting a grant die is silent and free. That
inverts the burden of proof every other consent system has backwards.

Four entities, each one visible to a user: `askonly.vault` (the ciphertext, in a `bytes` column,
carrying its own death block), `askonly.grant` (the capability), `askonly.access` (the receipt the
verifier must sign to be told the answer), and `askonly.refusal` (what someone tried to ask and was
not permitted to). A fifth, `askonly.request`, is the queue of questions the owner's browser answers from. `state` is a positive enum
throughout because the network has **no `NOT` and no `!=`**.

**Reads cost no gas**, so every query shape was validated against the live network with a
zero-balance wallet before anything was funded — and the README's judge-runnable query needs only a
free access key.

Graded files: `arkiv/friction.md` · `arkiv/reach.md` · `arkiv/why-arkiv.md` ·
`arkiv/how-you-use-arkiv.md`, plus `arkiv/schema.md`.

*(~249 words.)*

### 4.2 0G — Build with 0G Private Computer

**AI is the product, not a feature.** India's documents are unsigned, unstructured scans and PDFs.
There is no issuer signature to build a ZK circuit over, which is why every selective-disclosure
project went after the handful of credentials that happen to be signed. A language model inside a
confidential VM is the first universal adapter from real paper to a purpose-limited answer.
**Without 0G there is nothing to ask** — the document would have to be handed over, which is the
entire problem.

Every answer surfaces its 0G `x_0g_trace.request_id` and the provider address that served it, in
the UI and in the Arkiv receipt. Measured on a real AskOnly prompt: `glm-5.3`, provider
`0xD179F4526064846dE9a9E9D93683AF75CB72E503`, **5.3 s, $0.000685 per call**, completion 105 /
reasoning 85 tokens.

`assertTeeML()` exists because **TeeML is not TeeTLS**: TeeML means the model runs inside the
enclave, TeeTLS protects only the transport. The same `glm-5.3` is also served by Baidu and Tencent
with no TEE at all, and only about 7 of 123 router models carry the `verifiability` field. We refuse
any provider whose `verifiability !== "TeeML"`, and `X-0G-Provider-Trust-Mode: private` returns 503
rather than silently downgrading. `max_tokens` is floored at 1500 because glm-5.3 emits reasoning
tokens first and returns an empty string below that — an empty completion is treated as an error,
never as an answer.

Minimisation is measured rather than asserted: on the end-to-end run **the enclave saw 4 of 12
lines** of the document.

*(~235 words.)*

### 4.3 ENSv2 — Best Use of ENSv2

The authorization is not a row in our database and not a text record. **The question set a verifier
may ask *is* an ENSv2 EAC role bitmap on a name**, and `AskOnlyGate.sol` calls `hasRoles` in the hot
path: no role, no enclave call, and the owner's document is never decrypted. Revoking a permission
is revoking an ENS role — there is no application-level flag to forget to check.

The demo beat is the **refuse → grant → succeed** loop, which is what separates this from the
obvious ENSv2 demo of issuing subnames with permissions. The same question is refused and the
refusal is written to Arkiv where the owner can see what was attempted; a role is granted on-chain;
the identical question now answers. The authorization is visibly the ENS role and nothing else.

Two findings worth a judge's attention, because both cost real time. **`hasRoles(uint256 anyId,
uint256 roleBitmap, address account)` takes `uint256` as its first argument, not `bytes32`** — with
`bytes32` it reverts, and the revert looks exactly like a permissions failure. And **a nybble is a
boolean, not a 0–15 level**: `EnhancedAccessControl` validates every bitmap against
`ALL_ROLES = 0x1111…1111` and reverts `EACInvalidRoleBitmap` if any bit above a nybble's low bit is
set, so `1 << 40` is legal and `0xF << 40` is rejected. N question sets means N nybbles —
`income 1<<40`, `identity 1<<44`, `tenancy 1<<48`, `employment 1<<52`, all in the free range.

The production gate reads the canonical `ETHRegistry` at
`0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4`. Every address is read from `deployments.sepolia.json`;
**nothing is hard-coded in the UI.**

*(~249 words.)*

---

## 5. What we don't claim

A privacy project that overstates is worse than one that does less. This list is part of the
submission, not an appendix to it.

- **We do not erase bytes from history.** Arkiv's docs do not claim it, so neither do we. Expiry
  means queries stop returning the entity and operations on it fail. The defence against historical
  bytes is that they are AES-GCM-256 ciphertext encrypted in the owner's browser.
- **The enclave does not enforce our policy.** 0G Private Compute is an inference router, not a
  place to deploy code. Enforcement is at the client and the verifier, and we say so out loud.
- **0G does not sign the answer.** `GET /v1/proxy/signature/{chatID}` does not exist on the Router
  — eight path shapes probed with a live `chatcmpl` id, all 404. A receipt's `verification` field
  therefore says `provider-address`, never `signature`, and the enclave's identity is established by
  address against the live `/providers` list. `x_0g_trace.tee_verified` is the router's self-report
  and is labelled as such wherever it is shown.
- **Expiry kills the capability, not knowledge.** A landlord told "yes" still knows "yes". We shrink
  what is disclosed to one bit and make every bit accountable. Nothing makes knowledge revocable.
- **The TEE boundary is real but not absolute.** You are trusting Intel TDX, the dstack image and
  0G's gateway. TEE.fail (October 2025) happened.
- **We are not a registered Consent Manager** and cannot be — DPDP Rules First Schedule Part A item
  4 requires ₹2 crore net worth. AskOnly is the reference implementation a registrant would run.
  (Rule 4, the only route to registration, commences 13 November 2026.)
- **The writable demo ENS registry is a mock**, because roles cannot be granted on a name we do not
  control. It replicates the real `ALL_ROLES` validation and root-OR semantics, and the production
  gate deployed alongside it reads the canonical ETHRegistry. Both are labelled everywhere.
- **A hosted copy would be a trusted operator, so there is no hosted demo.** 0G's CORS allowlist
  rejects deployed origins, so a hosted instance would have to relay with its own key and could
  see the extract. `/api/mode` reports that and `/api/ask/relay` refuses to run on localhost, but
  no screen shows the banner yet, and the app does not use the relay. AskOnly runs on localhost.
- **Questions and verdicts are public.** Every question, its yes, no or unknown, the topic a
  reviewer may ask about, their display name and the document's name are stored in the clear on
  Arkiv. The document never is, and neither is any figure in it.
- **A browser that answers by itself keeps a key on disk.** While a permission is live, the
  owner's browser holds the document's key in IndexedDB as a non-extractable CryptoKey. No script
  can read it out, but Chrome writes it to the profile's files, so anyone who can read those files
  can open the document. The record ends with the permissions it serves.
- **The retention monitor is an observation over a window**, not a proof of absence for all time.

---

## 6. How it's made

**Stack.** Node ≥22.10, no framework. Arkiv Rabdi (chain 7794095, 2 s blocks) via
`@arkiv-network/sdk@1.0.1` with `viem@2.x`; five `askonly.*` schemas; writing wallet
`0x4CA8176777D44B76235684b63334088C618994e4`. Solidity and Hardhat for `AskOnlyGate.sol` and
`MockENSRegistry.sol`, 19 contract tests, deployed to Sepolia and verified by reading the
constructor values back — `AskOnlyGate 0xc0Aa8494d24EB40878cE9B3505Fe3023C75CF204`,
`MockENSRegistry 0x782E197F213c7eb04D578459a3b42bE861aC2E88`. ENSv2 `ETHRegistry` at
`0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4` on Sepolia. 0G Private Compute at
`https://router-api.0g.ai/v1`, `glm-5.3`, Intel TDX / dstack, trust mode `private`. Front end is
vanilla JS with WebCrypto (AES-GCM-256, PBKDF2 at 210,000 iterations) and `eth_signTypedData_v4`;
EIP-712 verification server-side in `src/auth/typed.mjs`. Self-hosted variable woff2 — EB Garamond
for display, Geist for UI, Geist Mono for every hash and address. No key ships in the repo.

Six things learned the hard way, each of which changed the code:

**1. 0G's CORS allowlist is per exact origin, including the port.** `http://localhost:5173` gets
`Access-Control-Allow-Origin` back; `:4319`, `:5174`, `:8080`, `:8000`, `:4200` and the deployed
Vercel origin all get **403**. The earlier mistake was trusting a 204 preflight — a 204 *without*
the ACAO header still fails in a real browser, and only loading an actual page revealed `Failed to
fetch`. On any other port the app silently falls back to relaying through the server, which
reintroduces exactly the trusted middleman this design exists to remove. Hence `npm start` serves on
5173 and nowhere else.

**2. `watchEntityEvents` is a chain-wide firehose, and nothing documents it as one.** It has no
schema, owner or key filter — `.ownedBy()` and `.createdBy()` exist on the *query* builder, which
makes it natural to assume the subscription has them. Measured on unfiltered subscriptions: 8 events
in 20 s with 0 of them ours, then **45 events in 24 s with 1 ours — 44 belonged to strangers.**
Unfiltered, the retention monitor shows unrelated wallets' retention as if it were the data
subject's, which is not merely wrong output but a false accusation rendered in a UI.
`src/arkiv/watch.mjs` now filters client-side, surfaces the drop count as the evidence that the
filter is load-bearing, and **throws rather than starting unfiltered.**

**3. The 0G enclave signature endpoint does not exist.** The receipt was designed around an enclave
signature verified against the provider's on-chain signer. Eight path shapes were probed with a live
`chatcmpl` id: all 404. The design changed instead of the claim — the receipt now binds the
**verifier's** EIP-712 signature over `(grantId, questionHash, answerHash, requestId)`, and the
answer is not released to their screen until they sign it. 0G cannot prove the enclave said it; we
can prove the landlord asked and was told, which is the record DPDP Rules 2025 First Schedule Part B
item 3 actually requires.

**4. Arkiv writes need typed value tags, not just query predicates.** The docs are emphatic about
`str()` / `addr()` / `u64()` in *predicates*; `createEntity` **values** need them too. The first
write failed with `Column "owner": a addr column, but the value is a str. Write addr(...) around the
value` — an unusually good error that names the column, both types and the fix. What made it cost
anything is that a bare JS string is accepted for a `str` column, so partial tagging appears to work
right up to the first non-string column. Every value is now tagged, strings included.

**5. Load-balanced RPC can serve two reads from nodes at different heights.** On Sepolia, two
`eth_call`s issued back to back right after a write returned `mayAsk = true` while `permittedSets`
returned `income = false` **in the same breath** — a visibly self-contradictory UI. The fix
generalises: pin every group of reads that must agree to a single block number, and throw if two
pinned reads of the same fact still disagree rather than quietly picking one.

**6. `extendEntity` takes an object, and the positional form produced a false pass.** It is
`extendEntity({ entityKey, expiration }, txParams)`. The positional form throws
`InvalidExpiryError`, so the test asserting "every operation on a dead entity fails" passed while
proving nothing. A false proof is worse than a missing one; the test now asserts on the failure
*reason*, not on failure. Related sharp edge: `str` is 128 **bytes**, not characters — `₹` costs 3
bytes and `मियाद` is 5 characters and 15 bytes — so `fitStr()` truncates on a code-point boundary.

One more worth stating: `rabdi({ accessKey })` path-encodes the access key into the RPC URL, so
every error leaving the Arkiv layer is scrubbed of `ark_live_*` and of URLs before it can reach a
log, a terminal or a UI toast.

---

## 7. Pre-submission checklist

Ordered by what blocks a submission. Unchecked items are genuinely outstanding as of this draft.

**Blocking — repo and paperwork**

- [ ] **Public GitHub repo.** `github.com/DanishVahora/eth_global` exists and is still **private**.
      Commit, push and flip it public at submission. 26 commits of real history exist, which matters —
      ETHGlobal treats "repositories with single commits of large files without proper history" as
      unqualified.
- [x] **Open-source licence** — `LICENSE`, MIT, at the repo root.
- [x] **AI-use disclosure** — `AI-DISCLOSURE.md`, including the five places the AI was wrong and how
      each was caught.
- [x] **README with the writing wallet and one query a judge can run** —
      `0x4CA8176777D44B76235684b63334088C618994e4` and `scripts/judge-query.mjs`, which needs only a
      free access key because reads cost no gas.

**Blocking — the four graded Arkiv files (25% each)**

- [x] `arkiv/friction.md` — Arkiv feedback
- [x] `arkiv/reach.md` — Reach
- [x] `arkiv/why-arkiv.md` — Why Arkiv
- [x] `arkiv/how-you-use-arkiv.md` — How you use Arkiv
- [x] `arkiv/schema.md` — lists all five entities, including `askonly.request`, with the fields
      queried, who owns them and when they expire.
- [ ] Two rubric questions lack an explicit answer. `why-arkiv.md` is asked "**what did you keep off
      Arkiv, and why?**" — the answer is in the prose (the passphrase, the document key, the
      plaintext, all personal data) but is not stated under that question. `reach.md` is asked "**can
      they try it today, and will you keep building it after Mumbai?**" — the second half is not
      answered anywhere.

**Blocking — the two-party claim this copy makes**

- [x] **No owner passphrase on the reviewer's screen.** `app/public/js/ask.js` is gone, and the
      reviewer's page in `web/src/pages/Ask.jsx` has no passphrase field and no way to decrypt.
- [ ] Owner inbox demonstrated across two browser profiles with two different wallets (PLAN-V2 gates
      A1 and A4): ask in one window, watch it light up in the other.
- [ ] A tampered EIP-712 payload refused with a named error (gate A2). `src/auth/typed.mjs` and
      `verifyTypedData` are in place; the rejection path still needs to be shown.

**Blocking — submission artefacts**

- [ ] **Demo video, under 3 minutes.** `docs/DEMO.md` is scripted for 4 minutes and must be cut. It
      has to keep the refusal, the answer with a visible `request_id`, and a death on camera — set
      the grant life to 2 minutes before recording.
- [ ] **Live demo link.** Required by the ENSv2 track. The hosted instance must ship with the
      permanent trusted-operator banner, because 0G's CORS allowlist blocks deployed origins.
- [ ] **Three track picks selected on ETHGlobal:** Arkiv — Build on Arkiv (from scratch) · 0G
      Private Computer · ENSv2. Arkiv's prizes count as one partner prize, so the Arkiv + Swarm bonus
      would not consume a fourth pick.
- [ ] Re-run `npm run preflight` and `npm test` on a cold clone immediately before submitting.

**Not pursued**

- [ ] Arkiv + Swarm bonus ($500) requires `/arkiv/swarm.md` with a postage batch ID and the wallet
      that bought it. There is no batch ID, the upload gateway returns 405 and there is no testnet
      faucet. Leave it unless a batch ID is obtained at the booth.

---

## 8. Arkiv rubric check

Run against the live Arkiv MCP Mumbai profile `https://mcp.arkiv.network/mumbai` on 6 November
2026, 11:21 UTC. It is a POST-only Streamable HTTP endpoint — a GET returns 405 and that is normal,
not an outage.

**Connecting.** `initialize` returned HTTP 200 with
`"serverInfo":{"name":"arkiv-mumbai","version":"2.1.0"}` and `"protocolVersion":"2025-06-18"`. **No
`Mcp-Session-Id` header was returned and none was needed** — every subsequent `tools/list` and
`tools/call` succeeded as a plain stateless POST.

`tools/list` returned **17 tools**. Both of the ones we were looking for exist: `check_submission`
and `check_schema`. They have **byte-identical descriptions** and identical input schemas
(`{ text: string }`, 1–20,000 characters):

> *"Check a public Mumbai draft against the dated live organizer snapshot using shallow declared
> rules; findings never certify eligibility or an application."*

### 8.1 What the tools returned

Sections 1–6 of this document (16,402 characters) were sent to `check_submission`. The response, in
full and verbatim:

```json
{"validation":"shallow_text_check","verifiedApplication":false,"summary":"no blockers found","blockers":0,"warnings":0,"findings":[]}
```

`check_schema` was called twice — once with the same text, once with the full contents of
`arkiv/schema.md` — and **returned exactly the same object both times**, byte for byte. On this
profile the two tools appear to be the same check.

### 8.2 Do not read that as a rubric pass

A clean result here is worth very little, and saying so is more useful than quoting it as a win. We
ran negative controls to find out what the check actually detects:

| Text sent to `check_submission` | Response |
|---|---|
| `"AskOnly is a todo list app. We did not use Arkiv. There is no licence and no repo."` | `no blockers found`, 0 findings |
| `"The ETHGlobal Mumbai submission deadline is 7 November 2026 at 09:00 IST. Our project is certified eligible… and our application has been approved."` | `no blockers found`, 0 findings |
| `"x"` (a single character) | `no blockers found`, 0 findings |
| A draft containing a literal `ark_live_…` access key and a `0x…` private key | **`blockers: 1`** |

Only the last one produced a finding, and it was about secrets rather than about the rubric:

```json
{"severity":"blocker","rule":"sensitive-input",
 "message":"Remove sensitive material locally before checking the draft.",
 "quote":"","quoteTrust":"untrusted",
 "acceptedShapes":["A public draft with no credentials or confidential material."]}
```

So `check_submission` is a **credential and confidentiality scanner, not a rubric scorer.** It
confirms this draft is safe to share publicly and contains no leaked key. It does not and cannot
confirm the submission qualifies — the tool says so itself with `"verifiedApplication": false` and
with *"findings never certify eligibility or an application"* in its own description. A project that
plainly fails every qualification requirement gets the same clean response this document did.

### 8.3 The actual rubric, and where it disagrees with us

The real criteria came from `read_knowledge` with `id: "mumbai/prizes"`, which serves a dated
logged-out snapshot of `https://ethglobal.com/events/mumbai/prizes/arkiv`
(`verifiedAt: 2026-11-03T18:47:26.809Z`, digest `e54fe158…6dbe74`, 14,928 bytes). It is a snapshot,
not frozen rules — the live page wins, and it must be rechecked before submitting.

For **Build on Arkiv (from scratch), $4,000**, the graded files and their questions are:

- **Arkiv feedback (25%) — `/arkiv/friction.md`.** *What should we improve today; when something
  broke, what did you expect, what happened, and how can we reproduce it?* Answered, with measured
  numbers and reproduction commands.
- **Reach (25%) — `/arkiv/reach.md`.** *Who is it for, and would they use it? **Can they try it
  today, and will you keep building it after Mumbai?*** The first half is answered. **The second
  half — whether this continues after Mumbai — is not answered anywhere in the repo.** Add a line.
- **Why Arkiv (25%) — `/arkiv/why-arkiv.md`.** *If you swapped Arkiv for Postgres, what would your
  users lose? **What did you keep off Arkiv, and why?*** The first question is the strongest part of
  the submission. **The second is answered only implicitly** — the passphrase, the document key, the
  plaintext and all personal data are deliberately kept off Arkiv because everything on it is
  public. State it under its own heading rather than leaving a grader to infer it.
- **How you use Arkiv (25%) — `/arkiv/how-you-use-arkiv.md`.** *Do the things you filter on, who can
  edit each entity, and when it expires fit what your app does? Does each Arkiv feature you use
  change something your users see?* Answered.

Qualification requirements, checked one by one against the snapshot text:

| Requirement | State |
|---|---|
| Built from scratch at Mumbai, ETHGlobal's rules | Yes |
| Writes to Arkiv's current testnet with `@arkiv-network/sdk`, **and at least one feature users see reads its data from Arkiv** | Yes — the reviewer's thread and the owner's Documents, Reviewers and Questions pages all read from Arkiv |
| README: **the wallet address(es) that wrote your entities, and one query we can run** | Yes — `0x4CA8176777D44B76235684b63334088C618994e4`, `scripts/judge-query.mjs` |
| `/arkiv/schema.md`: your entities, the fields you query, who owns them, when they expire | Yes — all five entities |
| One file per judging criterion, at the path next to it | Yes, all four |
| Public repo with an open-source licence | **Licence yes; the repo is still private.** See §7 |
| Say how you used AI | Yes — `AI-DISCLOSURE.md` |
| *Not counted:* the SDK installed but never used to read, or Arkiv used only as a log nothing reads | Not applicable — reads are in the hot path of every screen |

One more thing the snapshot says that affects the track picks: **"Each team can win one Arkiv track
prize; the Arkiv + Swarm bonus can come on top of it,"** and *"Arkiv's prizes count as one partner
prize on ETHGlobal, so it does not use another of your three picks."*

**Net result of the rubric check:** the MCP's automated checker reports no blockers, but that
signal is near-meaningless. Validating by hand against the snapshot the MCP serves found **two
content gaps** (`reach.md` has no "after Mumbai" answer; `why-arkiv.md` has no explicit "what did
you keep off Arkiv" answer) and **two qualification gaps** (`schema.md` does not document
`askonly.request`; the repo is not yet public). All four are in the checklist in §7.
