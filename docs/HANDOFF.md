# AskOnly: handoff

**Written for: the next Claude Code session.** Danish will open a fresh chat in this repo and point
you here. Read this before touching anything.

Deadline: **Sat 7 Nov 2026, 09:00 IST** (ETHGlobal Mumbai).

---

## What the product is

Answer questions **about** a document without sending the document, under a permission that expires
on-chain.

- **One wallet popup a week, per browser.** The wallet signs a `Session`: a key this browser generated
  may sign for it on AskOnly for 7 days. After that, sealing, adding a reviewer, asking, answering,
  ending and deleting are no popup at all. Records keep both signatures, so each still traces to a wallet.
- The owner seals a document (AES-GCM in their browser; the server stores ciphertext). Sealing is signed.
- They **add a reviewer**: a wallet, and for how long. That is the only decision the owner ever makes
  about them. Optionally they can limit what may be asked about. **There is no question count.**
- The reviewer's browser signs each question with its session key. Every question traces to their wallet.
- **The owner's browser answers by itself.** Only it can decrypt. Before it pays for anything it checks
  the owner's signature over the permission and the asker's over the question, so it never takes the
  server's word. It starts with the fewest lines that might answer (identifiers like a PAN held back as
  `[withheld]`), asks a **TEE enclave**, widens to the whole document only if that cannot settle it, and
  signs the verdict with the key the owner's signature named.
- The reviewer receives `YES / NO / UNKNOWN` plus a receipt. No document, no key, no figures.

**The one honest limit:** the owner's browser must be open somewhere, with the wallet connected (a
background tab is fine; it resumes by itself after a reload, with no passphrase). If it is closed,
questions wait. Answering with it closed means giving the server the key, which ends the claim that the
server never sees the document. Danish was told this directly. Do not quietly change it.

---

## Fixed on the night of 6 to 7 Nov, after an independent review

An independent review found the honest path working and two core claims false. All of this is fixed
and proven (`npm run prove:integrity`, `web/scripts/verify-check.mjs`):

- **Any wallet could plant AskOnly entities.** A schema is only a tag. Every ledger read now filters on
  `$creator` = the writing wallet (`.createdBy(ours())` in `src/arkiv/ledger.mjs`, 17 reads).
- **A grant's signed expiry was ignored**, the lifetime came from unsigned `minutes`/`days`, and the same
  signature could be posted again forever. Now `diesAt` is stored as signed, and the grant id is derived
  from the signed message (`recordId` in `src/auth/typed.mjs`), so one signature makes one permission.
  Grants are also refused over a document the signer does not own.
- **Signed questions could be replayed.** `askedAt` must be within 10 minutes and is stored as signed;
  the request id comes from the signed message. Line breaks are refused (they could forge a topic line).
- **The owner's browser answered whatever `/api/inbox` listed.** It now verifies both signatures first
  (`signedByOwner`, `signedByAsker` in `web/src/lib/askonly.js`).
- **Verdicts were unchecked.** The server recomputes `answerHash = sha256({answer, band})`, takes only
  listed bands, and refuses a signed refusal sent as an answer.
- **A refusal could be written after the owner ended the permission**, and checks ran before the write
  queue. Now every check runs again inside the write's turn (`prepare` in `settleAnswered`).
- **Two tabs lost keys or paid twice.** Keys are now kept per document as a list, merged on disk, shared
  between tabs over a BroadcastChannel, pinned while a reviewer is being added, and the lock is released
  only after an answer in flight finishes.
- Also: an expired delegation no longer blocks a named key; sessions end with the permissions that name
  their key and carry `until`; a rejected 0G key is caught (Shell shows "Add 0G key", `KeySheet.jsx`);
  the browser checks for a TeeML provider *before* sending lines; a paid stage is never paid twice;
  "anything" scopes can never be turned down; Read always asks for the passphrase; the public hash is of
  the ciphertext; the answer statement no longer says "the document was not sent".

**Permissions issued before about 01:30 IST on 7 Nov cannot be answered any more**: their stored expiry
is not the signed one, so the browser refuses to trust them, and says "a reviewer added before this
update has to be added again". End them and add the reviewer again.

---

## Changed on 7 Nov, from Danish's feedback

- **"Each time users need to confirm."** A `Session` (`src/auth/typed.mjs`) replaces a popup per seal,
  reviewer, ending, deletion and permission. The wallet sees one readable line and the end date in UTC;
  the server rebuilds that date from `diesAt` and refuses a session that says anything else, that runs
  past 8 days, or that another wallet signed. A refused session is a 401 with `code: session-expired` or
  `session-invalid`, and the browser signs in again. The wallet-signed paths, `AskKey` and `Delegation`
  still work.
- **"How many times a reviewer can ask."** The `Grant` type lost `usesAllowed`. New grants store `0` and
  are never `spent`. Old grants that carry a count were signed under `GrantTypesV1` and still hold to it.
  What stops a runaway script now: 10 questions waiting on one permission, 30 per 10 minutes, then a 429
  with `retryAfterMs`.
- **"Why ask for a 0G key here?"** `GET /api/zerog/key` hands the key in `.env` to a page on this machine
  only (loopback connection, no forwarding headers, Origin and Sec-Fetch-Site must be this app's; everyone
  else gets a 404, with no CORS headers). The browser still calls 0G itself. `KeySheet` appears only when
  0G turns down both the owner's key and the machine's.
- `POST /api/vault` is signed (`Seal`, over the hash of the bytes actually sent).

---

## Guarantees, each with a script that proves it

| Command | Asserts |
|---|---|
| `npm run smoke` | it imports, boots, and answers |
| `npm run prove` | two-party: the server pays every write and can author none |
| `npm run prove:delegation` | the fallback key for another browser is narrow |
| `npm run prove:session` | a session signs for its wallet and nothing looser; records trace back; no count, and the brake holds |
| `npm run prove:asking` | several questions at once, an old grant's count holds, an end is an end, one signature is enough |
| `npm run prove:forget` | only the owner can delete, only the document they named |
| `npm run prove:integrity` | a signature does what was signed, once; the reviewer's ask key works on its own permission only |
| `ASKONLY_URL=http://localhost:5174 node web/scripts/verify-check.mjs` | the owner's browser accepts real records and catches every change the server could make |
| `npm run prove:accuracy` | the answers are right, against the real enclave (last run: 231/232, 0 leaks) |

Run them against a **fresh server**, not Danish's: `PORT=5430 node --env-file=.env app/server.mjs`, then
`ASKONLY_URL=http://localhost:5430`. Two processes writing with the one wallet collide on the nonce; a
node that refuses a send is retried, but a send that times out is not (it may land), so a run that
overlaps Danish using the app can fail with "Timed out while waiting for transaction". That is the
harness, not the product.

---

## Still owed

1. **The ENS claim is not true of the code.** `docs/SUBMISSION.md` section 4.3 says `hasRoles` is checked in
   the hot path. `mayAsk` is imported in `app/server.mjs` and never called. Danish has to decide: wire it
   into `POST /api/request`, or change the claim.
2. Push, and flip the GitHub repo public at submission. Commit in small pieces: ETHGlobal may disqualify
   large single commits.
3. Demo video, under 3 minutes. Script in `docs/DEMO.md` (updated for the one-signature reviewer).
4. A session cannot be ended early from the server. Signing out drops the key from the browser; a copied
   key keeps working until its 7 days are up.
5. **There is no hosted demo.** On any origin but `localhost:5173` the browser cannot reach 0G, and the app
   does not use `/api/ask/relay` or show the operator banner. `docs/SUBMISSION.md` §5 now says so.
6. From the review, not done: the reviewer's page does not yet verify the answer's signature chain (the
   server checks the hash, but an operator writing to Arkiv directly is caught only by reading the chain);
   questions and verdicts are public on Arkiv (disclosed in the app and in §5, not encrypted); a locked
   wallet stops answering (stated in the copy); the 0G key in localStorage is shared by wallets in one
   browser; questions under an expired permission stay `pending` on chain for 7 days (the inbox hides them).
7. Accuracy's one miss: an offer letter answered "yes" to "is she the vice president of human resources".

---

## Hard-won facts: do not rediscover these

- **0G CORS is an exact-origin allowlist including port.** `localhost:5173` works; everything else gets a
  **403**. Vite on 5173 proxies `/api` to the API.
- **0G's 429 is `model_overloaded`**, upstream and brief, with a `retry-after`. Not a limit on us (500/min).
  Nothing was read and nothing was spent, so it is a wait and never a failure.
- **A free 0G key check:** `GET /v1/account/balance` answers an unknown key with **401** and a real one with
  403. `/providers` and `/models` answer 200 to anything.
- **EIP-712 domain is chain-agnostic**: `{name:"AskOnly", version:"1"}`, no `chainId`. Pinning one made
  MetaMask throw when the user was on another network.
- **Arkiv writes need typed value tags**: `str()`, `addr()`, `u64()`, `u256()`, `bytes()`. `addr("")` throws.
- **A schema is a tag anyone can write.** Filter reads on `$creator` (`.createdBy()`, works on `count()` too).
- **`wallet.executeBatch({creates, patches}, {gas})` is atomic.** Prefer it for anything that must land together.
- **`ExpirationTime.fromSeconds(n)` needs a whole number of 2s blocks.**
- **Each RPC call is about 200ms from here and a write makes 10 to 16 of them.** The clients poll every 500ms.
- **viem puts the RPC URL in error messages**, and the RPC is on `arkiv.network`: never regex a whole
  message for words like "network". Use `name`, `shortMessage`, `details`.
- **`str` is 128 bytes.** A question or scope that does not fit is refused, never cut. The composer counts bytes.
- **Select the columns you read.** Several times a value was written and never selected back.
- **Sepolia public RPC is load balanced.** Reads that must agree are pinned to one block in `src/chain/gate.mjs`.
- **ENSv2 `hasRoles` takes `uint256`, not `bytes32`**, and a nybble is a boolean: `1<<40` legal, `0xF<<40` reverts.
- **A non-extractable CryptoKey is still on disk.** Chrome writes its bytes into the profile's IndexedDB
  files. `keystore.js` says so; do not claim otherwise.

### Driving the browser headlessly

MetaMask does not exist in headless Chrome, so there is a real signer:

```bash
node --env-file=.env scripts/testwallet.mjs     # :5310, two throwaway accounts. 0 = Owner, 1 = Landlord
```

Inject it through `navigate_page`'s `initScript` as `window.ethereum`, forwarding `eth_signTypedData_v4` to
`POST :5310/sign` (it records `window.__signs`, which is how "one popup" is checked). Its keys are new on
every run, so restarting it orphans the test documents. Vite can trigger a full reload after some edits,
which drops the injection, so re-navigate. The automation tool's `fill` does not work on a multi-line
value in a textarea: set it through the native value setter and dispatch an `input` event.

Verified this way at 01:55 IST: seal, add a reviewer (one `Grant`), the reviewer asks two questions (one
`AskKey`, no more), both answered by the owner's tab in 16s, a reload resumes with no passphrase, End is
one `Revoke`, Delete is one `Forget`, and Read asks for the passphrase.

Verified again on build 7 (test wallet on `TESTWALLET_PORT=5311`): a whole run of seal, add a reviewer,
two questions, both answered on the machine's 0G key, End and Delete took exactly two signatures, one
`Session` per wallet.

---

## Shape of the code

```
src/auth/typed.mjs      EIP-712: Session, Seal, Grant (+V1), Request, AskKey, Answer, Delegation, Forget,
                        Revoke, Presence; requireParty (wallet or session); recordId
src/arkiv/ledger.mjs    reads (all createdBy) and writes; settleAnswered / settleRefused re-check inside the queue
src/arkiv/client.mjs    guardedWrite: one write at a time, waits out a pending nonce, resends only refused sends
src/ask/questions.mjs   prompts, line selection, identifier masking, extractStages
src/ask/enclave.mjs     server-side 0G call, assertTeeML(), parseAnswer()
app/server.mjs          API; pays gas, verifies signatures, never sees plaintext

web/src/lib/answering.jsx  THE ENGINE. Above the routes. Verifies, answers, keeps keys, resumes after reload.
web/src/lib/keystore.js    keys in IndexedDB, and what that does and does not protect
web/src/lib/askonly.js     crypto, the EIP-712 mirror, the direct enclave call, signedByOwner / signedByAsker
web/src/lib/session.js     the browser's session key: signs in once, signs everything after
web/src/lib/questions.js   MIRRORS src/ask/questions.mjs. Prompts must stay byte-identical.

web/src/components/Shell.jsx       the top bar (restyled by the landing session), status, "Add 0G key" if 0G refuses
web/src/components/IssueSheet.jsx  add a reviewer: the only decision the owner makes
web/src/pages/Ask.jsx              the reviewer's thread; asks through the session
```

The landing page (`web/src/pages/Landing.jsx`, `web/src/landing.css`, `web/src/components/landing/*`,
`web/src/lib/smooth.jsx`) and the app's visual layer were done by a second session, `eth-global-c8`.

---

## Working with Danish

- He tests in his own Chrome and sends screenshots. Several real bugs came from him, not from the tests.
  When he says something is broken, it is.
- He asks for the agent harness and "no mistakes": verify with a script or a browser before reporting
  anything as working. He has caught claims that were not checked.
- His bar is that it should feel like a real company's product: fewer things on screen, one obvious action,
  no jargon. He said "reviewer" and "issuer", and the UI says "reviewer" and "you".
