# Reach

Who this is for, how many of them there are, and — the part most hackathon submissions skip —
what we would have to be right about for this to matter.

---

## 1. The person

A tenant in Mumbai is asked for a payslip to rent a flat.

The landlord wants to know one thing: can this person pay ₹25,000 a month. What he receives is a
PDF containing the tenant's employer, employee ID, PAN, bank account number, home address,
designation, joining date and exact salary. It goes into a WhatsApp thread, a broker's laptop
and an email archive. The tenant has no idea how many copies exist, and if they ask for deletion
afterwards, the only available answer is somebody's word.

The same transaction happens with HR verification, NBFC loan applications, school admissions,
visa paperwork and gig-platform onboarding. In every case **one bit is wanted and a whole
document is surrendered**, because handing over the document is the only mechanism available.

AskOnly replaces the mechanism. The landlord gets the bit. Nobody has to be trusted to delete
anything, because nothing was transferred.

---

## 2. How many

The honest numbers we can cite, with sources, rather than a market size we invented:

- **595.11 million** cumulative consents fulfilled and **352.19 million** accounts linked on
  India's Account Aggregator network as of September 2026 (Sahamati's public dashboard). This is
  the closest existing analogue to consented data sharing at scale in India, and it is already
  operating at nine figures.
- India's **DPDP Rules 2025** (G.S.R. 846(E), gazetted 13 November 2025) created a registered
  **Consent Manager** category. Rule 1(3) brings Rule 4 into force **one year after
  publication — 13 November 2026**, which is six days after this hackathon's deadline. Rule 4 is
  the only route to registration, so **there cannot be a registered Consent Manager in India
  today**.
- Penalties under the DPDP Act reach **₹250 crore**, which is what turns this from a nice idea
  into a budget line for the companies currently receiving those PDFs.

What we will not claim: a number for "people who shared a document they didn't need to". No
such figure exists, and inventing one would be the easiest thing in this document to disprove.

---

## 3. Who else benefits — and why the verifier is the surprising one

The data subject is the obvious beneficiary. The **verifier** is the one with the budget.

If you are a landlord, an NBFC or an HR team, every document you receive is a liability you did
not want:

- Under DPDP §8(7) you must erase on consent withdrawal, **and cause your processors to erase**.
  You cannot do that for a PDF that has been forwarded twice.
- Rules 2025 require **48 hours' advance notice to the data principal** before erasure.
- EDPB Opinion 28/2024 §114 goes further for anyone training on it: a regulator may order
  *"the erasure of the whole dataset used to develop the AI model and/or the AI model itself."*

So ingestion is now an existential risk for the receiving party too. **Both sides want the
question answered without a transfer.** AskOnly is not asking a verifier to accept less; it is
offering to take a liability off them.

---

## 4. Why this could not have been built three years ago

Selective disclosure already exists — in the form of ZK credentials that need an **issuer** to
sign **structured** data. That works for a digitally-signed government credential.

India's actual documents are unsigned, unstructured scans and PDFs: salary slips, bank
statements, rent agreements, Form 16s. **There is no circuit for a photograph of a payslip, and
no issuer signature to build one over.** Every ZK-credential project went after the handful of
documents that happen to be signed, because those were the only ones they could serve.

A language model running inside a confidential VM is the first universal adapter from
real-world paper to a purpose-limited answer. That is why the 0G layer is load-bearing rather
than decorative: remove it and there is nothing to ask.

---

## 5. Beyond the first use case

The same primitive — *a capability to ask one question about a document you will never receive,
which expires on its own* — is not specific to income or to India:

- **Healthcare.** "Is this patient on anticoagulants?" without releasing the discharge summary.
- **Age and eligibility.** "Is this person over 18?" without the ID.
- **Insurance and claims.** "Was this vehicle serviced in the last 12 months?" without the
  service book.
- **Agents.** The sharpest version. An autonomous agent that needs a fact about you should hold
  a capability that dies on its own, not a copy of your document in its context window forever.
  AskOnly's grant is exactly the right shape for that, and the expiry matters more, not less,
  when the counterparty is a program that never forgets.

---

## 6. What has to be true for this to matter

Stated plainly, because these are the things that would sink it:

1. **Verifiers have to accept a bit instead of a document.** This is the real adoption question.
   Our argument is liability, not altruism — and the DPDP penalties give it teeth — but a
   landlord who insists on the PDF is entitled to, and we have not solved that.
2. **Someone has to be a registered Consent Manager.** We cannot be: Part A item 4 of the First
   Schedule requires **₹2 crore net worth**. AskOnly is the reference implementation a
   registrant would run, and the open protocol for the category. That is the honest positioning.
3. **The TEE trust boundary has to hold.** You are trusting Intel TDX, the dstack image and 0G's
   gateway. TEE.fail (October 2025) is a real result and we are not going to pretend otherwise.
4. **The enclave has to read messy documents correctly.** It did on our tests, including
   answering "no" when a threshold was not met. At scale this needs far more evidence than a
   hackathon provides.

---

## 7. What Arkiv gets out of it

A use case that is not in Arkiv's own published list — token lists, chain registries, address
labels, agent coordination state, expiring marketplace listings — and that does not merely
*store* data on Arkiv but depends on a property no other store has.

Arkiv currently sells expiry as cost control: pay for the duration you need. **Nobody is selling
it as evidence.** Arkiv is the only data layer we found that can show, publicly and without an
indexer, that a record stopped existing and that nobody quietly extended it. That turns a
pricing footnote into compliance infrastructure, in a jurisdiction where a regulated category
with no incumbents opens six days from now.
