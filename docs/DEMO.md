# Demo: under 3 minutes

**The shape:** one document, one reviewer, several questions with nothing to click, then the
permission dies on screen. Start with the landlord. Let the thesis land at the end.

---

## Before you start

```bash
npm run preflight          # live checks. If any fail, fix before recording.
npm start                  # http://localhost:5173, and only that port
```

**Two wallet accounts.** Account 1 is you, Account 2 is the landlord. Use two browser profiles, so
the owner's tab stays open and answering while you drive the landlord's.

Have ready:
1. `http://localhost:5173/` on the landing page
2. A short payslip as a text file or PDF
3. Your 0G key saved once beforehand, so its field doesn't appear on camera

Try the whole thing once first. The first enclave call of a session can be slower, and 0G sometimes
says it is briefly overloaded. The app waits that out by itself, but it is dull to film.

---

## 0:00 The situation (20s)

> "I'm renting a flat in Mumbai. The landlord wants to know I earn enough. So I send him my payslip,
> which has my employer, my PAN, my bank account and my exact salary on it. He needs one word. I
> gave him my life."

Landing page, scroll once, press **Seal a document**.

## 0:20 Seal it (25s)

Connect Account 1. Drop the payslip. Name it, type a passphrase, press **Encrypt and seal**.

> "It's read and encrypted here in my browser. What leaves is ciphertext, and it carries its own
> expiry on Arkiv."

## 0:45 Add a reviewer (25s)

The next step opens by itself. Paste the landlord's address, call them Landlord, pick **2 minutes**,
press **Sign and get the link**. One wallet popup.

> "This is the only decision I make. Who, and for how long. One signature."

Copy the link. Press **Done**.

> "I won't be asked about any of his questions. My browser answers him from here."

## 1:10 He asks, and nobody clicks (50s) ← *the beat that sells it*

In the second profile, Account 2, open the link. Send these one after another without waiting:

1. **Can they afford rent of 25,000 a month?**
2. **Are they still employed there?**
3. **What is their PAN number?**

> "His wallet signed once, for this permission. Every question since is signed in his browser
> before he's told anything, so there's a record that he asked. I'm not touching my wallet either."

Answers land: **Yes**, comfortably above. **Yes**. The third comes back **Unknown** or **No**, with no
number in it.

> "That's all he gets. A word. Asking for my PAN doesn't get him my PAN."

Open a **Receipt**.

> "This names the enclave that answered, an Intel TDX machine on 0G, and says how much of the document
> it read. It started with the fewest lines it could. The same model is served by providers with no
> enclave at all, and an answer from one of those is thrown away."

## 2:00 The record (15s)

Back to Account 1. Sidebar, **Questions**.

> "I can see everything he asked and what went back. A record, not a to-do list."

## 2:15 The death (30s) ← *the thesis*

Sidebar, **Reviewers**. Wait for the countdown, or press **End** if you are short of time. Back in the
landlord's tab, the box is gone.

> "It's not flagged or soft-deleted. The network stopped returning it, and every operation on it fails.
> Keeping a permission alive is a public, signed act. Letting it die is silent."

## 2:45 Close (15s)

> "Every company promises to delete your data, and none of them can prove they did. So we stopped
> asking."
>
> **"He never had the document. There's nothing to delete."**

---

## Questions you will get

**"Does the owner have to be online?"**
> Their browser does, and a background tab is enough. It's the only thing that can open the document,
> so it's the only thing that can answer. It picks up by itself after a reload. If it's fully closed,
> questions wait. We could answer while it's closed by giving our server the key, and then we'd be one
> more company asking you to trust us.

**"Does the enclave see the whole document?"**
> Sometimes. It starts with the lines that look relevant and reads further only if those can't settle
> the question, because a wrong "unknown" is useless. Every receipt says how much it read, and whatever
> it reads, one word comes back.

**"How is this different from ZK selective disclosure?"**
> ZK needs an issuer to sign structured data. India's real documents are unsigned, unstructured scans.
> There's no circuit for a photograph of a payslip. A model in an enclave is the first universal adapter
> from real paper to one word.

**"What stops you faking a receipt?"**
> Nothing at the router level, and we say so. 0G exposes no signature endpoint: we probed eight paths
> with a live request id, all 404. What we do prove is narrower and real: the provider address that
> answered, checked live against the attested list, and the reviewer's own EIP-712 signature, produced
> before they're shown the answer.

**"Doesn't your server see the document?"**
> No, and it can't write a record on its own either. The browser decrypts and calls the enclave directly,
> which is why port 5173 matters: 0G allowlists it by exact origin. The server pays Arkiv gas, and it
> verifies a signature from the right party before each write. `npm run prove` tests that.

**"Arkiv doesn't really delete the bytes though."**
> Correct, and we never say it does. Expiry means queries stop returning the entity and operations fail.
> The historical bytes are ciphertext encrypted with a passphrase that never left the browser.

---

## If something breaks

| Symptom | Do this |
|---|---|
| A question sits on "Answering" for a while | 0G is briefly overloaded. It retries by itself. Never relax the trust mode. |
| Reviewer sees "their browser is closed" | The owner's profile isn't on AskOnly. Open it, and it resumes without a passphrase. |
| Browser can't reach 0G | You're not on port 5173. Everything else gets a 403. |
| Red banner about older code | Stop `npm start` and run it again. |
| Arkiv write fails | `npm run preflight`. Most likely the wallet needs tGLM from `hub.arkiv.network/faucet`. |
| Port 5173 is busy | `npx kill-port 5173`, then `npm start`. |
