# Demo — 4 minutes

Finalists get 7 minutes: 4 demo, 3 Q&A. This is the 4.

**The shape:** a refusal, an answer, and a death. Do not start with the thesis — start with the
landlord, and let the thesis land in beat 6.

---

## Before you start

```bash
npm run preflight          # 14 live checks. If any fail, fix before going on stage.
npm start                  # http://localhost:5173  — NOT any other port
```

Have open, in this order:
1. `http://localhost:5173/` — the landing page
2. `http://localhost:5173/vault.html` — your side
3. A second window for the verifier, with a wallet connected

Set the grant life to **2 minutes** before you begin. The countdown has to expire on camera.

---

## 0:00 — The situation (20s)

> "I'm renting a flat in Mumbai. The landlord wants to know I earn enough. So I send him my
> payslip — which has my employer, my PAN, my bank account number, my home address and my exact
> salary on it. He needs one bit. I gave him my life."

Scroll the landing page hero once. Don't explain it; it explains itself.

## 0:20 — Seal the document (30s)

On `vault.html`. The payslip is already in the box.

> "It encrypts here, in my browser. The passphrase never leaves this page."

Press **Encrypt here, then store**. Point at the output:

> "Two kilobytes of ciphertext, stored on Arkiv, with a death block on it. The document itself
> expires — not a flag that says it should."

## 0:50 — Issue a capability (30s)

> "Now I give the landlord a capability. Not a copy — a question."

Set: `landlord.eth`, **income**, threshold `50000`, 3 uses, **2 minutes**. Press
**Issue the capability**. Point at the one line that matters:

> "This is the only thing he will ever be able to ask. It's recorded verbatim, and its hash goes
> into every receipt."

## 1:20 — The refusal (40s) ← *the beat that wins the track*

Switch to the verifier window. Press **Ask something else**.

> "He asks for my exact salary. Refused — and look where it was refused."

> "The question set he's allowed to ask isn't a row in my database. It's a **role on an ENS
> name**. `hasRoles` said no, so the enclave was never called and my document was never
> decrypted. Revoking his permission is revoking an ENS role. There's no application-level flag
> to forget to check."

Show the refusal landing in the ledger. **The owner can see what he tried to ask.**

## 2:00 — The answer (50s)

Press **Ask it**. While it runs (about 6 seconds — don't hide the wait, narrate it):

> "This is going into an Intel TDX enclave on 0G. Trust mode is private, which routes only to
> TeeML providers and returns 503 rather than silently downgrading."

Point at the provider panel:

> "The same model is also served by Baidu and Tencent with **no enclave at all**. We refuse any
> provider that isn't TeeML and discard an answer that comes back from one."

Then the signature gate:

> "The answer exists, but he can't see it yet. He signs a receipt first — he cannot be told the
> answer without a record that he asked."

Sign. The stamp lands.

> "YES. And look at what the enclave actually saw: **four lines of twelve**. My employer, my
> PAN, my account number and my address never entered it. Not withheld from the landlord —
> withheld from the model."

Point at the request id.

## 2:50 — The death (50s) ← *the thesis*

Back to the vault. The countdown is in **blocks**.

> "That permission dies in ninety seconds. Not when a cron job gets round to it — the network
> stops returning it."

Let it hit zero on screen. Refresh the verifier window:

> "Gone. Not flagged, not soft-deleted, not tombstoned. The query returns nothing and every
> operation on it fails."

Now the retention monitor:

> "And here's the part I care about. Arkiv emits an event when someone **extends** a record, and
> **nothing at all** when one dies. So keeping a permission alive is a signed, public,
> timestamped act — and letting it die is silent. The burden of proof inverts. Retention becomes
> the thing you have to explain."

*(If you have 10 spare seconds: press **Extend 7d** on another grant and show the event appear.)*

## 3:40 — Close (20s)

> "Every company on earth promises to delete your data, and none of them can prove they did —
> that's a theorem, not a complaint. Certified deletion is impossible with classical
> information. So we stopped asking."
>
> **"He never had the document. There is nothing to delete, because he never held it."**

---

## Q&A — the five you will get

**"How is this different from ZK selective disclosure?"**
> ZK needs an issuer to sign structured data. India's real documents are unsigned, unstructured
> scans — salary slips, bank statements, rent agreements. There is no circuit for a photograph of
> a payslip and no issuer signature to build one over. That's why every ZK credential project
> went after the handful of documents that happen to be signed. A model in an enclave is the
> first universal adapter from real paper to one bit.

**"What stops you faking a receipt?"**
> Be direct: nothing at the router level, and we say so on the page. 0G exposes no signature
> endpoint — we probed eight path shapes with a live request id, all 404. So we don't claim an
> enclave signature. What we do claim is narrower and real: the provider address that answered,
> checked live against the attested provider list, and **the verifier's own EIP-712 signature**,
> which they produce before they're shown the answer. We can't prove the enclave said it. We can
> prove the landlord asked it and was told — and that's the record DPDP First Schedule Part B
> item 3 actually requires.

**"Doesn't your server see the document?"**
> Not in local mode, and that's why the port matters. 0G's router allowlists browser origins by
> exact origin, and `localhost:5173` is on the list — so the browser calls the enclave directly
> with the owner's own key. The server never has the key or the extract. Run it hosted and the
> operator *does* become a trusted party, which is why the hosted instance carries a permanent
> banner saying exactly that, and why `/api/ask/relay` refuses to run on localhost.

**"Arkiv doesn't really delete the bytes though."**
> Correct, and we never say it does — their docs don't claim it either. Expiry means queries stop
> returning the entity and operations fail. The historical bytes are AES-GCM-256 ciphertext
> encrypted in my browser with a passphrase that never left it. And notice the claim we're
> making isn't "it was deleted" — it's "he never held it." That's the whole point of choosing
> non-collection over deletion.

**"Your ENS registry is a mock."**
> The writable one is, because I can't grant roles on a name I don't control. It replicates the
> real `ALL_ROLES` validation — `1<<40` legal, `0xF<<40` rejected — and the root-OR semantics,
> so nothing passes there that Sepolia would refuse. The production gate deployed alongside it
> reads the canonical ETHRegistry at `0xd4ebcb…a8b4`, and `ensIsLiveRegistry` is computed from
> chain state, not declared. Both are labelled in the UI and the README.

---

## If something breaks

| Symptom | Do this |
|---|---|
| Enclave returns 503 | It found no free TeeML provider. Retry — **never** relax trust mode on stage. |
| Enclave is slow | It's 5–10s. Narrate the wait; it's honest, and the provider panel gives you something to talk about. |
| Browser can't reach 0G | You're not on port 5173. Everything else 403s. |
| Arkiv write fails | `npm run preflight` — most likely the wallet needs tGLM from `hub.arkiv.network/faucet`. |
| Wallet won't sign | Fall back to narrating the receipt panel; the answer path still works. Say the signature is what gates the reveal. |
| Everything is on fire | `node --env-file=.env scripts/e2e.mjs` runs the whole loop headless in ~90s and prints every proof. |
