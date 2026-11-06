# AI use disclosure

Required by the Arkiv track, and worth writing honestly rather than minimally.

## The short version

**This project was built by one person working with Claude (Anthropic) as a coding
assistant, across several Claude Code sessions running side by side on 6 and 7 November
2026.** The AI wrote most of the code and the prose in this repository. Claims about
external systems were checked against those systems before they were allowed to stay.
Claims about the app's own behaviour drifted as the code changed, and a final audit on
7 November caught them (item 10 below).

## What the AI did

- Wrote the Solidity, the Arkiv data layer, the 0G enclave client, the server and the
  entire front end, from a plan it drafted and the author approved.
- Wrote the documentation in `arkiv/`, this file, and the README.
- Ran every probe and test in `scripts/`, read the output, and corrected itself when the
  output disagreed with what it had written.
- Redesigned the landing page and the app, and built the once-a-week sign-in: one wallet
  signature per browser instead of one for every action.
- Wrote the prompt for the logo, then measured the images that came back and redrew the mark
  as SVG. The prompt is in `docs/image-prompts.md` and the images are in `docs/brand/`.
- Worked as several sessions at once, each owning different files and coordinating by
  message. One of them read every submission document against the code on 7 November.

## What the author did

- Chose the idea, the framing and the sponsor tracks, and dropped ENSv2 when the audit showed
  the app does not use the ENS gate.
- Set the design direction (the house style is the author's own site) and the constraint
  that the UI must not look generated.
- Used the app and asked for what changed it most: fewer wallet popups, no 0G key to paste,
  and no limit on how many questions a reviewer can ask.
- Rejected several earlier project ideas, which is why this one exists.
- Supplied all credentials. No key is in this repository.
- Generated the logo in ChatGPT from that prompt and chose the version that ships.

## Where the AI was wrong, and how it was caught

Listing these because "we used AI" is not a disclosure; what it got wrong is.

1. **It claimed a browser could call 0G's router directly, on the strength of a CORS
   preflight returning 204.** That was not proof — a 204 without an
   `Access-Control-Allow-Origin` header still fails in a real browser. Testing from an
   actual page showed `Failed to fetch`. The allowlist turned out to be per exact origin
   including port, and only `localhost:5173` works. Caught by running the thing instead of
   reasoning about it.
2. **It wrote an expiry test that passed for the wrong reason.** `extendEntity` takes an
   object, not positional arguments; the wrong shape threw `InvalidExpiryError`, so the
   assertion "every operation on a dead entity fails" passed while proving nothing. Caught
   by reading the failure message rather than the exit code.
3. **It left a stale `diesAt` mirror after extending a grant**, so an extended permission
   rendered as expired. Caught by noticing a judge-facing script printing `dies@block
   588998` and `overdue` on the same line.
4. **It initially assumed the Arkiv MCP endpoint was dead** because a GET returned 405. It
   is a POST-only transport and is alive. Caught by sending a real `initialize`.
5. **It planned the receipt around a 0G enclave signature that does not exist.** Eight path
   shapes probed with a live `chatcmpl` id, all 404. The design changed rather than the
   claim.
6. **It put the plaintext on the server.** An early `/api/ask/prepare` took the decrypted
   document and narrowed it server-side, which quietly made the server a party that sees it:
   the exact thing the product promises it is not. The browser now does all of it. The
   removal is recorded in `app/server.mjs`.
7. **It asked for the owner's passphrase on the reviewer's screen.** The first hand-rolled
   pages had a `prompt()` for the owner's passphrase on the verifier's side, which would have
   handed over the document. It went with the move to React.
8. **It shipped routes anyone could call on anyone's behalf.** Sealing was unsigned, so anyone
   could put a document in anyone's list, and ending a permission or deleting a document took
   an id from whoever posted it. Both now need the owner's signature (`src/auth/typed.mjs`).
9. **It accepted replayed and mismatched signatures.** Until 7 November a permission's signed
   expiry was checked and then ignored, the same signature could be posted again, a permission
   could be signed over someone else's document, a signed question could be resent, and an
   answer's verdict was never compared with the hash that was signed. Every other proof stayed
   green because none of them tried. `scripts/integrity-prove.mjs` now tries each one.
10. **Its documents claimed more than the app did.** The submission said every question was
    checked against an ENS role, that the reviewer signs a receipt before being shown the
    answer, and that no name is stored on Arkiv. None of these was true of the current code.
    A final audit on 7 November read every document against the code and caught them. The
    claims were corrected, and the ENSv2 track was dropped.

## Models

Claude (Anthropic), through Claude Code: Claude Opus 5 (`claude-opus-5`) and Claude Opus 5.5
(`claude-opus-5-5`), across several sessions. The enclave the product itself calls is
`glm-5.3` on 0G Private Compute, which is a product dependency rather than a development tool.

The two logo images in `docs/brand/` came from ChatGPT's image generator (OpenAI).

## The rule that was applied throughout

No claim about an external system — Arkiv, ENSv2, 0G, Swarm or Indian law — was allowed
into the code or the documentation unless it had been checked against that system, with the
output recorded. Where something could not be verified it is marked unverified, and where a
verification failed the claim was removed rather than softened. `arkiv/friction.md` is
mostly a record of that process. Claims about the app itself were held to the same rule only
at the end, by the audit in item 10.
