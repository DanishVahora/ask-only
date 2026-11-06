# AskOnly

**Answer the question. Never send the file.**

A consent layer where a reviewer never receives your document, only signed answers to the questions
they ask, and where the permission is destroyed by the network rather than by a promise.

ETHGlobal Mumbai 2026 · From Scratch · MIT

---

## The idea in one paragraph

Your landlord wants to know you earn enough. He does not need your payslip, your PAN, your bank
account or your address. He needs one word. You put the document into AskOnly; it is read and
encrypted **in your browser** and the ciphertext goes to Arkiv carrying its own death block. You add
the landlord as a reviewer: his wallet, and for how long. That is the only decision you make, and your
wallet asks you to sign at most once a week on this browser. He asks whatever he likes in his own words, and **your browser answers by itself**, because only
your device can open the document. It decrypts locally, sends the fewest lines that can answer to a
model inside an Intel TDX enclave, and signs the result with a key your signature named. He gets
**Yes**. When the time is up, Arkiv stops returning the permission and every operation on it fails.

## Two parties, and a server that cannot speak for either

This is the part that makes it a protocol rather than a demo.

```
REVIEWER                        ARKIV                      OWNER'S BROWSER
   │                                                             │ 0. one signature: who, how
   │                                                             │    long, and the key that
   │                                                             │    may answer until then
   │ 1. connect wallet, sign the question (EIP-712)              │
   ├──────────► askonly.request  state=pending ─────────────────►│
   │                                                             │ 2. it sees it, with
   │                                                             │    nothing for anyone to click
   │                                          3. decrypt locally │
   │                                             call the enclave│
   │                                             sign the answer │
   │◄────────── askonly.access (the answer, signed) ◄────────────┤
   │ 4. reads the answer, and only the answer                    │
```

Only the owner's device holds the passphrase, so only the owner's device can decrypt and ask.
**The reviewer can request an answer and never produce one.** The owner decides once, when they add
the reviewer, and their browser does the rest. It has to be open somewhere, even in a background tab.
If it is closed, questions wait, and that is the price of nobody else being able to answer for you.

Browser wallets are on Sepolia, not Arkiv's chain, and nobody will fund a second chain to try a
demo — so **the server pays for every Arkiv write.** That is acceptable only because it cannot
author the records that matter: every seal, grant, question and answer carries an EIP-712 signature,
from the wallet or from a key the wallet signed in for a week, and the server verifies it before
writing. *The operator pays for those records and cannot author one.* Refusals are not signed; see
"What we don't claim".

Proven with three fresh wallets, none of them the server, by `scripts/twoparty-prove.mjs` (green on
7 November; the weekly sign-in has its own proof, `npm run prove:session`):

| Attempt | Result |
|---|---|
| junk signature | **401** refused |
| the landlord signing *as* the owner | **401** refused |
| a stranger using someone else's permission | **403** refused |
| **the asker answering their own question** | **403** refused |
| answering an already-decided request | **409** refused |
| what the verifier receives | an answer — no ciphertext, no key, no document |

## Your file never leaves your machine

PDFs, photos and text all work, and the file itself is never uploaded — not to this server, and
not to the enclave either.

| You drop | Read by | Where |
|---|---|---|
| `.pdf` | pdf.js text layer | your browser |
| `.png` `.jpg` `.webp` | Tesseract OCR | your browser |
| `.txt` `.md` `.csv` | directly | your browser |

0G *does* serve an image-capable TeeML model, so a photograph could be sent into the enclave
whole. We deliberately do not: that would mean the enclave sees the employer, the PAN, the bank
account and the address. Extracting on the device keeps minimisation intact: asked whether they can
afford ₹25,000 rent, the enclave is first shown **7 of the sample payslip's 16 lines**; asked for the
PAN, it gets one line, `PAN: [withheld]`. It widens only when those cannot settle the question.

**Why bother:** you cannot prove you deleted data. Broadbent & Islam (TCC 2020) proved certified
deletion is impossible with classical information. So deletion is the wrong primitive.
Non-collection is the right one — *you can never prove you deleted it; you can prove you never
held it.*

---

## A query you can run

Reads cost no gas on Arkiv, so this needs **no funded wallet and no private key** — just a free
access key (about 30 seconds at <https://hub.arkiv.network/access-keys>).

```bash
npm install
ARKIV_ACCESS_KEY=ark_live_... node scripts/judge-query.mjs
```

It reads every record the app's server wrote (`.createdBy()` on its address), for every user. Real
output from 7 November, abridged:

```
Arkiv Rabdi · chain 7794095 · block 308418
writing wallet 0x4CA8176777D44B76235684b63334088C618994e4

5 capability(ies) still returned by the network:
  g-9a23550a  Landlord       general     revoked  4/100 used  dies@block 345551  37131 blocks left
  g-2b3f8cbe  Landlord       income      spent    5/5 used  dies@block 344614  36194 blocks left
  …

5 receipt(s) — these outlive the permission on purpose:
   asked "Is monthly income above INR 50000?"
    -> YES  req req-abc123
    -> enclave 0xD179F4526064846dE9a9E9D93683AF75CB72E503  verified by: provider-address
  …

5 refusal(s) — questions that were turned down:
  "Is it a permanent role?"  refused: out-of-scope
```

Permissions issued since 7 November carry no question count and print as "N asked".

**Look at what is missing.** Several capabilities were issued while building this. Only the ones
that have not passed their death block come back. An expired entity is not flagged, tombstoned
or soft-deleted — the network simply stops returning it. *That absence is the product.*

Run it again in a few minutes and short-lived grants will have vanished on their own.

**Writing wallet:** `0x4CA8176777D44B76235684b63334088C618994e4`

---

## Run the whole thing

```bash
npm install
npm --prefix web install
cp .env.example .env     # ARKIV_ACCESS_KEY, DEPLOYER_PRIVATE_KEY, SEPOLIA_RPC_URL, ZEROG_API_KEY

npm run preflight        # proves Arkiv, ENSv2 and the 0G enclave are all live
npm run chain            # in a second terminal: the local chain the contract tests run on
npm run compile && npm test       # 19 contract tests
npm start                # API + web.  Open http://localhost:5173
```

You need a browser wallet. Any injected wallet works — MetaMask, Rabby, Coinbase, Brave, OKX,
Phantom, Frame — discovered via EIP-6963 and listed by name. There is no WalletConnect and no
RainbowKit, deliberately: both want a cloud `projectId`, which puts a third-party service in the
critical path of a demo given on venue wifi.

**Trying it alone?** Add a second account in your wallet. Issue the permission to that second
address, switch to it to ask, then switch back to answer. The app follows whichever account is
selected.

> **Port 5173 is not arbitrary.** 0G's router allowlists browser origins by *exact origin,
> including port*. `http://localhost:5173` gets `Access-Control-Allow-Origin` back;
> `localhost:4319`, `:5174`, `:8080`, `:8000`, `:4200` all get **403**. On any other port the
> browser cannot reach the enclave, and the app deliberately does not fall back to relaying through
> the server, which would reintroduce exactly the trusted middleman this design exists to remove.
> `strictPort` is set so it fails loudly instead of sliding to another port. The API takes the
> next free port from 5174 and hands it to Vite's proxy.

Proof scripts, each of which measures rather than asserts:

| Command | What it proves |
|---|---|
| `node --env-file=.env scripts/twoparty-prove.mjs` | **the two-party protocol end to end — that the server pays for every write and cannot author one** |
| `npm run prove:session` | one wallet sign-in per browser: expired, too-long, wrong-date and stranger sessions refused; signed seals; permissions with no count; the rate limit |
| `npm run prove:integrity` | a signature does what was signed, once: no replays, no other expiry, no other verdict, no write after an end |
| `ASKONLY_URL=http://localhost:5174 node web/scripts/verify-check.mjs` | the owner's browser checks what the server sends, and catches every change |
| `node --env-file=.env scripts/arkiv-prove.mjs` | writes a vault, grant, receipt and refusal; measures the event firehose |
| `node --env-file=.env scripts/arkiv-expiry.mjs <grantId>` | watches a permission die and shows every operation on it fail |
| `node --env-file=.env scripts/arkiv-retention.mjs` | proves extension is loud and death is silent |
| `node --env-file=.env scripts/ens-demo.mjs` | the ENS role gate on its own, which the app does not use: refuse → grant → succeed → revoke, on Sepolia |

---

## Architecture

```
   OWNER'S BROWSER (localhost:5173)                 REVIEWER'S BROWSER
   AES-GCM-256, holds the document key              a wallet, and questions
        │ ciphertext           │ the fewest lines          │ signed
        ▼                      ▼                           ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐
   │ ARKIV (Rabdi)    │   │ 0G PRIVATE CPU   │   │ ASKONLY SERVER     │
   │ vault · grant    │   │ glm-5.3, TeeML   │   │ checks signatures, │
   │ request · access │   │ Intel TDX        │   │ pays the Arkiv gas │
   │ refusal          │   │ trust = private  │   └────────────────────┘
   └──────────────────┘   └──────────────────┘
   a grant's $expiresAt IS the permission
```

| Layer | Role | Why nothing else does it |
|---|---|---|
| **Arkiv** | the capability, and the document | expiry is *enforced by the network*; extension emits an event, death emits nothing |
| **0G PC** | the only reader | a model in a TDX enclave is the only adapter from unsigned, unstructured paper to one bit |

**An ENS role gate, built but not used by the app.** `AskOnlyGate.sol` checks an ENSv2 role bitmap
with `hasRoles`, has 19 contract tests, and `scripts/ens-demo.mjs` runs refuse → grant → answer on
Sepolia. The web app does not consult it: its permissions are Arkiv records. Deployed on Sepolia,
verified by reading the constructor values back:

| Contract | Address |
|---|---|
| `AskOnlyGate` (production, reads canonical ENSv2) | [`0xc0Aa8494d24EB40878cE9B3505Fe3023C75CF204`](https://sepolia.etherscan.io/address/0xc0Aa8494d24EB40878cE9B3505Fe3023C75CF204) |
| `MockENSRegistry` (writable demo registry) | [`0x782E197F213c7eb04D578459a3b42bE861aC2E88`](https://sepolia.etherscan.io/address/0x782E197F213c7eb04D578459a3b42bE861aC2E88) |
| `AskOnlyGateDemo` | [`0xEd17815fF920bc13A160ec504f9ef710B1E6ef14`](https://sepolia.etherscan.io/address/0xEd17815fF920bc13A160ec504f9ef710B1E6ef14) |

Addresses live in `deployments.sepolia.json`.

---

## Arkiv track

The four graded documents, plus the schema:

- [`arkiv/why-arkiv.md`](arkiv/why-arkiv.md) — why this is impossible on anything else
- [`arkiv/how-you-use-arkiv.md`](arkiv/how-you-use-arkiv.md) — the five entities and the queries the server runs
- [`arkiv/friction.md`](arkiv/friction.md) — everything that was rough, measured
- [`arkiv/reach.md`](arkiv/reach.md) — who this is for and what has to be true
- [`arkiv/schema.md`](arkiv/schema.md) — every attribute and the limits it is built against

The headline measurement, from `scripts/arkiv-expiry.mjs`:

```
block 283073  QUERYABLE   2 blocks to live
block 283075  GONE        past death block
  ok read it by id    failed: not returned by any query
  ok patch its state  failed: reverted. Reason: no entity 0x32b3d3c1…0ecde5 —
                      it may have been deleted, or have expired
  belonging to THIS permission : 0
  No extension event was emitted for this permission. It was allowed to die.
```

---

## What we don't claim

A privacy project that overstates is worse than one that does less.

- **We do not erase bytes from history.** Arkiv's docs do not claim it, so neither do we. Expiry
  means queries stop returning the entity and operations fail. The document is AES-GCM-256
  ciphertext encrypted in the owner's browser; that is what protects historical bytes.
- **The enclave does not enforce our policy.** 0G Private Compute is an inference router, not a
  place to deploy code. Enforcement is at the client and the verifier, and we say so out loud.
- **0G does not sign the answer.** We intended to verify an enclave signature against the
  provider's on-chain signer. `GET /v1/proxy/signature/{chatID}` does not exist on the Router —
  eight path shapes probed with a live `chatcmpl` id, all 404. So a receipt's `verification`
  field says `provider-address`, never `signature`, and the enclave's identity is established by
  address against the live provider list. `x_0g_trace.tee_verified` would be the router's
  self-report and is labelled as such wherever shown.
- **Expiry kills the capability, not knowledge.** A landlord told "yes" still knows "yes". We
  shrink what is disclosed to one bit and make every bit accountable. Nothing makes knowledge
  revocable.
- **The TEE boundary is real but not absolute.** You are trusting Intel TDX, the dstack image
  and 0G's gateway. TEE.fail (October 2025) happened.
- **We are not a registered Consent Manager** and cannot be — the DPDP Rules First Schedule
  Part A item 4 requires ₹2 crore net worth. AskOnly is the reference implementation a
  registrant would run.
- **The ENS role gate is not used by the app.** It is deployed and tested on Sepolia (above), but
  the app's permissions are Arkiv records, so we are not entering the ENSv2 track.
- **A hosted copy would be a trusted operator, so there is no hosted demo.** 0G's CORS allowlist
  rejects deployed origins, so a hosted instance would have to relay with its own key and could see
  the extract. No screen warns about that yet and the app does not use the relay;
  `/api/ask/relay` refuses to run on localhost. AskOnly runs on localhost.
- **The weekly sign-in key sits in the browser.** The key that signs for a wallet for a week is in
  `localStorage`, so anyone who can run script on the page or read the browser profile can act as
  that wallet in AskOnly until it expires; the server cannot end it early. It cannot move funds.
- **Refusals are not signed, and the reviewer's screen trusts the server.** The owner's browser
  checks every signature before it answers, but a refusal carries no signature, and the reviewer's
  page does not re-check the owner's signature on an answer.

---

## AI use

Disclosed in full in [`AI-DISCLOSURE.md`](AI-DISCLOSURE.md).

## Licence

MIT — see [`LICENSE`](LICENSE).
