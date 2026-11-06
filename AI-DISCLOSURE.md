# AI use disclosure

Required by the Arkiv track, and worth writing honestly rather than minimally.

## The short version

**This project was built by one person working with Claude (Anthropic) as a coding
assistant, in a single session on 6 November 2026.** The AI wrote most of the code
and the prose in this repository. Every claim it produced about an external system
was checked against that system before it was allowed to stay.

## What the AI did

- Wrote the Solidity, the Arkiv data layer, the 0G enclave client, the server and the
  entire front end, from a plan it drafted and the author approved.
- Wrote the documentation in `arkiv/`, this file, and the README.
- Ran every probe and test in `scripts/`, read the output, and corrected itself when the
  output disagreed with what it had written.
- Wrote the prompt for the logo, then measured the images that came back and redrew the mark
  as SVG. The prompt is in `docs/image-prompts.md` and the images are in `docs/brand/`.

## What the author did

- Chose the idea, the framing and the three sponsor tracks.
- Set the design direction (the house style is the author's own site) and the constraint
  that the UI must not look generated.
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

## Models

Claude Opus 5 (`claude-opus-5`) for the work in this repository. The enclave the product
itself calls is `glm-5.3` on 0G Private Compute, which is a product dependency rather than
a development tool.

The two logo images in `docs/brand/` came from ChatGPT's image generator (OpenAI).

## The rule that was applied throughout

No claim about an external system — Arkiv, ENSv2, 0G, Swarm or Indian law — was allowed
into the code or the documentation unless it had been checked against that system, with the
output recorded. Where something could not be verified it is marked unverified, and where a
verification failed the claim was removed rather than softened. `arkiv/friction.md` is
mostly a record of that process.
