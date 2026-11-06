# Plan v2 — make it a real two-party system

Written 6 Nov 16:50 IST · **T-16h**

---

## What is actually wrong today

The app is a single-party simulation wearing a two-party costume.

| Today | The problem |
|---|---|
| The "owner" is the **server's** funded wallet `0x4CA8…` | Every user is the same user. There is no account. |
| The verifier is a hardcoded `0x…bEEF` | Nobody is really asking. |
| The verifier screen does `prompt("Owner passphrase")` | **Fatal.** If the verifier has the passphrase they have the document, and the entire premise is void. |

The hard question I avoided: **if only the owner's device can decrypt, then only the owner's
device can answer.** The verifier physically cannot produce an answer. I papered over that with a
passphrase prompt instead of solving it.

---

## The fix: the owner's device answers

This is the *consent inbox*, and it is also exactly what a DPDP Consent Manager is.

```
VERIFIER                          ARKIV                         OWNER'S DEVICE
   │                                                                  │
   │ 1. connect wallet, sign the ask (EIP-712)                        │
   ├───────────────► askonly.request  state=pending ─────────────────►│
   │                                                                  │ 2. request appears.
   │                                                                  │    Owner sees WHO and
   │                                                                  │    WHAT, and approves.
   │                                                                  │
   │                                                3. decrypt locally│
   │                                                   call enclave   │
   │                                                   sign the answer│
   │◄───────────── askonly.access  (answer + both sigs) ◄─────────────┤
   │ 4. reads the answer                                              │
```

The passphrase never leaves the owner's device. The verifier never holds anything but an answer.

### Who pays for the writes

Browser wallets are on Sepolia, not Rabdi, and nobody will fund a second chain to try a demo.
So **the server pays gas** — and that is fine, because it is a *paymaster, not a trusted party*:

- Every grant carries the owner's **EIP-712 signature** over its terms.
- Every request carries the verifier's signature.
- Every answer carries the owner's signature.
- **The server verifies each signature recovers to the claimed address before it writes.**
  A server that forged a grant would have to forge a signature.

Say this out loud rather than hiding it: *the operator pays for the transaction and cannot
author one.*

---

## Part A — the protocol

| # | Work | Gate |
|---|---|---|
| A1 | **Wallet auth, both roles.** Connect → address is the identity. Vaults, grants, ledger all scoped to the connected address, not the server wallet. | Two different addresses in two browser profiles see two different vaults |
| A2 | **EIP-712 everywhere + server-side verification.** `verifyTypedData` before any Arkiv write; reject on mismatch. | A tampered payload is refused with a named error |
| A3 | **`askonly.request` entity.** state `pending \| answered \| refused \| expired`, carrying the asker's signature and the question hash. Expiry = the grant's. | A request written by the verifier appears in the owner's inbox |
| A4 | **Owner inbox + approve.** Polls for pending requests against the owner's address. Approving decrypts locally, calls the enclave, writes the answer. | Two windows: ask on one, it lights up on the other |
| A5 | **Delete the passphrase prompt from the verifier screen.** | `grep prompt( app/public/js/ask.js` → nothing |

## Part B — the UI, decrowded

The rule: **the landing page explains, the app works.** A tool that re-explains itself on every
screen is a tool that does not trust its own interface.

| # | Work |
|---|---|
| B1 | Kill the display-serif headline on app screens. A compact header: small title, live status, nothing else. |
| B2 | Delete the explanatory paragraph on every app screen. Where a thing genuinely needs a word, it goes inline next to the control, at caption size. |
| B3 | Two columns become a real working layout: left = what you are doing, right = what is live. No prose in the right column. |
| B4 | One status surface, not three. Today there is a mode banner, a per-card tag, and a toast all saying overlapping things. |
| B5 | Density where density belongs. A list of permissions is a list, not a stack of cards with paragraphs. |

---

## Ordering, and what gets cut first

1. **A1 + A5** — wallet identity and killing the passphrase prompt. Without these it is not a product.
2. **A2** — signature verification. This is what makes the gas relay honest.
3. **A3 + A4** — the inbox. This is the demo.
4. **B1–B5** — the UI pass.
5. Submission paperwork (in parallel, by agent).

If time runs short, the cut line is **after 3**. The inbox with a plain UI beats a beautiful
single-party demo, because a judge will ask "so who is the other person?" and there has to be one.

## What stays true

Nothing in the honest-limits list changes. The server still never sees a passphrase, a document
key or a plaintext — now it additionally cannot author a grant, which is a stronger claim than
we could make this morning.
