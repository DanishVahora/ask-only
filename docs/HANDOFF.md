# AskOnly — handoff

**Written for: the next Claude Code session.** Danish will open a fresh chat in this
repo and point you here. Read this before touching anything.

Deadline: **Sat 7 Nov 2026, 09:00 IST** (ETHGlobal Mumbai). Written 6 Nov, 21:55 IST.

---

## What the product is

Answer a question **about** a document without sending the document, with a
permission that expires on-chain.

- The owner seals a document (AES-GCM in their browser; the server stores ciphertext).
- They issue a permission to one address: **their own words** for what may be asked,
  N uses, an expiry.
- The asker writes **their own question** in free text.
- Only the owner's device can decrypt, so only it can answer. It picks the minimum
  lines, asks a **TEE enclave**, and signs the verdict.
- The asker receives `YES / NO / UNKNOWN` plus a receipt. No document, no key, no figures.

**The owner is the enforcement point.** They read every question and can decline.
That is why fixed categories were removed — a taxonomy was never load-bearing.

---

## Three guarantees, each with a script that proves it

| Command | Asserts |
|---|---|
| `npm run smoke` | it imports, boots, and answers (added after a SyntaxError shipped) |
| `npm run prove` | two-party: 14/14, server pays every write and can author none |
| `npm run prove:delegation` | on-call: 7/7, the session key is narrow |

All three were **green at HEAD**. Re-run them after any change to
`app/server.mjs`, `src/auth/typed.mjs`, or `src/arkiv/ledger.mjs`.

They need a server. Start one on a spare port and point the script at it:

```bash
PORT=5208 node --env-file=.env app/server.mjs &
ASKONLY_URL=http://localhost:5208 node --env-file=.env scripts/prove-whichever.mjs
```

---

## State at handoff

Working tree **clean**. HEAD `622ec28`. **6 commits ahead of `origin/main` — not pushed.**
Remote exists: `https://github.com/DanishVahora/eth_global.git`

Recent work, newest first:

- `622ec28` answer accuracy + ask-again + on-call delegation
- `6cc0544` scope preview stopped looking like a question
- `c4d6559` no fixed categories anywhere
- `6868e4d` server wouldn't start; added `smoke`
- `08dc182` free-text questions; server stopped seeing plaintext

---

## What is NOT verified yet — start here

**The on-call loop has never been watched answering a real question in a browser.**
The protocol is proven 7/7 at the API level; the React loop in
`web/src/components/OnCall.jsx` is not. Specifically unproven:

1. `live.account.signTypedData(...)` — a viem local account signing EIP-712 **in the
   browser**, without a wallet. Verify the server accepts that signature.
2. The 2.5s poll actually seeing a pending request and completing the cycle.
3. `selectLines` returning `anyMatch: false` → the "left for you" path.

Also unverified in-browser: **Decline** (the `String(undefined)` → `"undefined"` bug was
fixed and unit-checked, never clicked).

### How to drive the browser headlessly

MetaMask doesn't exist in headless Chrome, so there's a real signer:

```bash
node --env-file=.env scripts/testwallet.mjs     # :5310, two throwaway accounts
curl "http://localhost:5310/select?i=0"         # 0 = Owner, 1 = Landlord
```

Inject it via `navigate_page`'s `initScript` as `window.ethereum` (EIP-1193 shim
forwarding `eth_signTypedData_v4` to `POST :5310/sign`). **An in-page
`location.reload()` drops the injection** — always re-navigate through
`navigate_page` instead.

CSS uppercases eyebrow labels, so `innerText` returns `YOU ARE ALLOWING`, not
`You are allowing`. Match case-insensitively or you'll get a false negative.

---

## Still owed

1. **Push to GitHub** — Danish approved a public repo. History was checked clean
   (every `ark_live_` hit is a redaction regex or placeholder). 6 commits waiting.
2. **Copy pass** — `docs/COPY-AUDIT.md`, 222 rows. Only the structural ones are done.
   Danish wants developer-speak gone, voice "slangy / intellectual", must not read AI-generated.
3. Four images per `docs/image-prompts.md`.
4. Demo video, under 3 minutes.
5. `arkiv/schema.md` still describes the templated-question model.

---

## Hard-won facts — do not rediscover these

- **0G CORS is an exact-origin allowlist including port.** `localhost:5173` works;
  `5174`, `8080`, `4200` return **403**. This dictates the port layout: Vite on 5173
  proxies `/api` to the API on 5174. A 204 preflight alone does not prove a real fetch works.
- **EIP-712 domain is chain-agnostic** — `{name:"AskOnly", version:"1"}`, no `chainId`.
  Pinning one made MetaMask throw "An internal error was received" when the user was on
  another network. `ACCEPTED_DOMAINS` tolerates older tabs.
- **Arkiv writes need typed value tags** — `str()`, `addr()`, `u64()`, `u256()`, `bytes()`.
  A bare string into an `addr` column throws.
- **`extendEntity` takes an object.** Positional args threw `InvalidExpiryError`, which
  made a test pass for the wrong reason.
- **Sepolia public RPC is load balanced** — back-to-back `eth_call`s can hit nodes at
  different heights. Reads that must agree are pinned to one block in `src/chain/gate.mjs`.
- **ENSv2 `hasRoles` takes `uint256`, not `bytes32`.** A nybble is a boolean: `1<<40` is
  legal, `0xF<<40` reverts `EACInvalidRoleBitmap`.
- **Select the columns you read.** Twice now a value was written to Arkiv and never
  selected back: `grantsOf` dropped `note` (every ticket read "unavailable"),
  `accessById` dropped `owner`/`asker` (every receipt unattributed). If a field reads
  as `undefined`, check the `.select({...})` before suspecting the write.

---

## Shape of the code

```
src/auth/typed.mjs      EIP-712: Grant, Request, Answer, Delegation + requireSignature
src/arkiv/ledger.mjs    reads/writes; Vault Grant Access Refusal Request
src/arkiv/schema.mjs    entity defs; fitStr() truncates on code-point boundary
src/ask/questions.mjs   guessTopic/keywords/selectLines — matches bring neighbours (context:1)
src/ask/enclave.mjs     0G call, assertTeeML(), pinned provider, parseAnswer()
src/chain/gate.mjs      ENSv2 reads, block-pinned; roleTagFor() maps any scope to a bit
app/server.mjs          API on 5174; pays gas, verifies signatures, never sees plaintext

web/src/pages/Vault.jsx         owner: seal, issue, tickets
web/src/pages/Ask.jsx           asker: free-text question, receipt, "Ask another"
web/src/components/Inbox.jsx    manual answer: unlock → line picker → enclave → sign
web/src/components/OnCall.jsx   delegated answering  ← the unverified one
```

`web/src/lib/questions.js` **mirrors** `src/ask/questions.mjs`. Change one, change both —
they have drifted before.

---

## Working with Danish

- He tests in his own Chrome and sends screenshots. Several real bugs came from him,
  not from the tests. When he says something is broken, it is.
- He asks for the agent harness and "no mistakes" — verify with a script or a browser
  before reporting anything as working.
- Do not claim something passes without having run it. He has caught that.
