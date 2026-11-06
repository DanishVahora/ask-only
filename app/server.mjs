/**
 * AskOnly — the local server.
 *
 * ── What this process is, and is not ──────────────────────────────────────────
 *
 * In LOCAL mode (you ran `npm start` on your own machine) this server:
 *   - serves the pages,
 *   - writes to Arkiv with the funded wallet,
 *   - reads ENSv2 on Sepolia,
 *   and takes NO PART in answering a question. The browser decrypts the document
 *   locally and calls router-api.0g.ai itself, with the owner's own key, which
 *   never arrives here. 0G's gateway allowlists localhost origins, so that
 *   direct call works - which is why there is no relay and no middle.
 *
 * In HOSTED mode (someone opened a deployed copy) the browser CANNOT reach 0G:
 *   the router's CORS preflight rejects non-localhost origins with 403. So the
 *   answer has to be relayed through here, and that makes whoever runs this
 *   process a trusted party who sees the extract. /api/mode reports
 *   `operatorSeesExtract: true` in that case and the UI shows a permanent
 *   banner. We would rather say that than quietly be it.
 *
 * The ciphertext posted to /api/vault is already encrypted by the browser. This
 * process never has the document key and never attempts to decrypt.
 */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { clients, account, readOnly, preflight, scrub, FAUCET } from "../src/arkiv/client.mjs";
import {
  putVault, issueGrant, liveGrant, grantsOf, vaultsOf, vaultCipher,
  recordAccess, recordRefusal, accessesOf, refusalsOf, spendGrant, extendGrant, revokeGrant,
  openRequest, decideRequest, pendingFor, requestById, accessById,
} from "../src/arkiv/ledger.mjs";
import { watchExtensions } from "../src/arkiv/watch.mjs";
import {
  GrantTypes, RequestTypes, AnswerTypes, grantMessage, requestMessage, answerMessage,
  requireSignature, SignatureError, clientSpec,
} from "../src/auth/typed.mjs";
import { gateStatus, permissionSurface, mayAsk, addresses, wiringError } from "../src/chain/gate.mjs";
import { QUESTION_SETS, canonicalQuestion, minimalExtract, systemPrompt, userPrompt, sha256hex } from "../src/ask/questions.mjs";
import { ask as askEnclave, assertTeeML, providers, DEFAULT_MODEL, PINNED_PROVIDER, MIN_MAX_TOKENS, baseUrl } from "../src/ask/enclave.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
/* The frontend is a React app in web/. In dev, Vite serves it on 5173 and
 * proxies /api here. In production we serve its build output. The old
 * hand-rolled pages are gone - with them went a prompt() for the OWNER's
 * passphrase on the VERIFIER's screen, which would have handed over the
 * document and voided the entire premise. */
const PUBLIC = path.join(ROOT, "web", "dist");
/**
 * 5173, and it is NOT an arbitrary choice.
 *
 * 0G's router allowlists browser origins by EXACT ORIGIN, port included. Probed
 * 2026-11-06 against /v1/chat/completions with a CORS preflight:
 *
 *   http://localhost:5173  -> 204 + Access-Control-Allow-Origin: http://localhost:5173
 *   http://localhost:4319  -> 403
 *   http://localhost:5174  -> 403      8080, 8000, 4200, 1420 -> 403
 *   https://pc.0g.ai       -> 204
 *
 * So 5173 (Vite's default, which 0G evidently allowlisted for developers) is
 * the ONLY local origin a browser can call the enclave from. Serve AskOnly on
 * any other port and the browser-direct path silently dies and you fall back to
 * relaying - which is precisely the trusted middleman this design exists to avoid.
 *
 * A status code alone is not proof here: checking only that the preflight
 * returned 204 would have missed that the response must also carry the
 * Access-Control-Allow-Origin header back.
 */
/* The API now runs on 5174 and Vite owns 5173.
 *
 * 5173 is not a preference - it is the ONLY localhost origin 0G's CORS
 * allowlist accepts (probed 2026-11-06: 5173 -> 204 with
 * Access-Control-Allow-Origin; 5174, 4319, 8080, 8000, 4200 -> 403). The
 * owner's browser calls the enclave directly, so the page must be served from
 * 5173 or that call dies and the app silently degrades to relaying through a
 * server - the trusted middleman this design exists to remove.
 *
 * So: Vite serves the app on 5173 and proxies /api here. */
const PORT = Number(process.env.PORT || 5174);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/* Arkiv context is built once. If it cannot be built we still boot, so the
   pages load and say what is wrong instead of showing a blank screen. */
let acct = null;
let ctx = null;
let bootError = null;
try {
  acct = account();
  ctx = clients(acct);
} catch (e) {
  bootError = scrub(e);
}

/**
 * The retention monitor, running for as long as this process does.
 *
 * `watchEntityEvents` is a CHAIN-WIDE firehose with no owner, key or schema
 * filter. Measured on this chain: 45 ExpiryExtended events in 24 seconds, 44 of
 * which belonged to nine unrelated wallets. An unfiltered monitor would present
 * strangers' retention as the owner's - which is not merely wrong, it is an
 * accusation. So we filter to our wallet and we report the drop count, because
 * the number of things we threw away is itself the evidence that filtering
 * was necessary.
 */
const retention = { seen: 0, kept: 0, dropped: 0, extensions: [], since: Date.now(), error: null };
let unwatch = null;
if (ctx && acct) {
  try {
    const w = watchExtensions(
      ctx.reader,
      (e) => {
        retention.extensions.unshift(e);
        if (retention.extensions.length > 50) retention.extensions.pop();
      },
      (e) => {
        retention.error = e;
      },
      { owners: [acct.address] },
    );
    unwatch = w.unwatch;
    // The stats object lives inside watchExtensions; mirror it on each read.
    retention._stats = w.stats;
  } catch (e) {
    retention.error = scrub(e);
  }
}

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store",
  });
  res.end(s);
};

const readBody = (req, limit = 2 * 1024 * 1024) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`body larger than ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });

const isLocalHost = (req) => {
  const host = String(req.headers.host ?? "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
};

const hexToBytes = (hex) => {
  const h = String(hex).replace(/^0x/, "");
  if (h.length % 2) throw new Error("odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
};

/* ------------------------------------------------------------------ routes */

const routes = {
  /** Everything a browser needs to produce a signature the server will accept. */
  "GET /api/spec": async (req, res) => {
    json(res, 200, {
      ...clientSpec,
      // Stated plainly because it is the honest part: we pay, we cannot author.
      paymaster: {
        address: acct?.address ?? null,
        note:
          "This server pays the Arkiv gas for every write. It verifies an EIP-712 " +
          "signature from the claimed party before writing, so it can pay for a " +
          "record but cannot author one.",
      },
    });
  },

  "GET /api/mode": async (req, res) => {
    const local = isLocalHost(req);
    json(res, 200, {
      mode: local ? "local" : "hosted",
      // The honest statement, computed rather than configured.
      browserCanReachEnclave: local,
      operatorSeesExtract: !local,
      operatorHasZeroGKey: !local && Boolean(process.env.ZEROG_API_KEY),
      note: local
        ? "Your browser calls the enclave directly with your own key. This server takes no part in answering."
        : "This hosted instance relays the question to the enclave with its own key, so whoever runs it can see the extract. Run it locally and nobody can.",
      zerogBase: baseUrl(),
      model: DEFAULT_MODEL,
      pinnedProvider: PINNED_PROVIDER,
      minMaxTokens: MIN_MAX_TOKENS,
    });
  },

  "GET /api/health": async (req, res) => {
    const chain = await gateStatus();
    let arkiv = { connected: false, reason: bootError ?? "not configured" };
    if (ctx) {
      try {
        const p = await preflight(ctx.reader, acct.address);
        arkiv = { connected: true, ...p, wallet: acct.address };
      } catch (e) {
        arkiv = { connected: false, reason: scrub(e) };
      }
    }
    json(res, 200, {
      ok: chain.connected && arkiv.connected,
      mode: isLocalHost(req) ? "local" : "hosted",
      chain,
      arkiv,
      questionSets: Object.fromEntries(
        Object.entries(QUESTION_SETS).map(([k, v]) => [k, { label: v.label, param: v.param, allowsBand: v.allowsBand }]),
      ),
      wiringError: wiringError ?? null,
      faucet: FAUCET,
    });
  },

  "GET /api/providers": async (req, res) => {
    const key = process.env.ZEROG_API_KEY;
    if (!key) return json(res, 200, { configured: false, providers: [] });
    try {
      const list = await providers(DEFAULT_MODEL, key);
      json(res, 200, {
        configured: true,
        model: DEFAULT_MODEL,
        pinned: PINNED_PROVIDER,
        providers: list,
        teeml: list.filter((p) => p.verifiability === "TeeML").length,
        nonTee: list.filter((p) => p.verifiability !== "TeeML").length,
      });
    } catch (e) {
      json(res, 502, { error: String(e.message).slice(0, 200) });
    }
  },

  /** The ENS authorization surface, all reads pinned to one block. */
  "GET /api/permission": async (req, res, url) => {
    const asker = url.searchParams.get("asker");
    const label = url.searchParams.get("label") ?? "";
    const registry = url.searchParams.get("registry") ?? "demo";
    if (!asker) return json(res, 400, { error: "asker is required" });
    try {
      json(res, 200, await permissionSurface(asker, label, registry));
    } catch (e) {
      json(res, 502, { error: String(e.message).slice(0, 240) });
    }
  },

  "GET /api/vaults": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const owner = url.searchParams.get("owner") ?? acct.address;
    try {
      json(res, 200, { owner, vaults: await vaultsOf(ctx.reader, owner) });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /** The ciphertext, for the owner's browser to decrypt locally. */
  "GET /api/vault": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const id = url.searchParams.get("id");
    if (!id) return json(res, 400, { error: "id is required" });
    try {
      const v = await vaultCipher(ctx.reader, id);
      if (!v) return json(res, 404, { error: `vault ${id} is not returned by the network` });
      json(res, 200, {
        ...v,
        cipher: `0x${Buffer.from(v.cipher).toString("hex")}`,
        bytesLen: v.cipher.length,
      });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "POST /api/vault": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      if (!b.cipher) return json(res, 400, { error: "cipher is required (encrypt in the browser)" });
      const cipher = hexToBytes(b.cipher);
      const out = await putVault(ctx, {
        owner: b.owner ?? acct.address,
        label: b.label ?? "Untitled document",
        docKind: b.docKind ?? "other",
        sha256: b.sha256 ?? "",
        iv: b.iv ?? "",
        cipher,
        days: Number(b.days ?? 180),
      });
      json(res, 200, out);
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "GET /api/grants": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const owner = url.searchParams.get("owner") ?? acct.address;
    try {
      json(res, 200, { owner, grants: await grantsOf(ctx.reader, owner) });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /** A grant that is gone is a 404 - and that 404 IS the expiry. */
  "GET /api/grant": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const id = url.searchParams.get("id");
    if (!id) return json(res, 400, { error: "id is required" });
    try {
      const g = await liveGrant(ctx.reader, id);
      if (!g) {
        return json(res, 404, {
          error: `grant ${id} is not returned by the network`,
          expired: true,
          explain:
            "This is not a missing record. Past its death block Arkiv stops returning the entity and every operation on it fails.",
        });
      }
      json(res, 200, g);
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "POST /api/grant": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      if (!QUESTION_SETS[b.questionSet]) return json(res, 400, { error: "unknown question set" });

      // The owner signed these exact terms. Verify before spending our gas on
      // them - this is what makes the paymaster arrangement honest.
      const owner = await requireSignature({
        address: b.owner,
        types: GrantTypes,
        primaryType: "Grant",
        message: grantMessage({
          vaultId: b.vaultId,
          verifier: b.verifier,
          questionSet: b.questionSet,
          question: b.question,
          usesAllowed: b.usesAllowed ?? 3,
          diesAt: b.diesAt,
        }),
        signature: b.ownerSig,
      });

      const out = await issueGrant(ctx, {
        vaultId: b.vaultId,
        owner,
        verifier: b.verifier,
        verifierName: b.verifierName ?? "",
        questionSet: b.questionSet,
        usesAllowed: Number(b.usesAllowed ?? 3),
        minutes: b.minutes ? Number(b.minutes) : null,
        days: b.days ? Number(b.days) : 7,
        threshold: String(b.threshold ?? ""),
        note: b.question ?? "",
        labelId: 0n,
        ownerSig: hexToBytes(b.ownerSig),
      });
      json(res, 200, out);
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, { error: e.message });
      json(res, 502, { error: scrub(e) });
    }
  },

  /* -------------------------------------------------- the second party ---
     A verifier cannot answer, only ask. This writes a pending request into
     the owner's inbox, signed by the asker before they are told anything. */
  "POST /api/request": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      const grant = await liveGrant(ctx.reader, b.grantId);
      if (!grant) {
        return json(res, 404, {
          error: "that permission no longer exists",
          expired: true,
          explain: "Past its death block Arkiv stops returning the entity and every operation fails.",
        });
      }

      const asker = await requireSignature({
        address: b.asker,
        types: RequestTypes,
        primaryType: "Request",
        message: requestMessage({
          grantId: b.grantId,
          questionHash: b.questionHash,
          askedAt: b.askedAt,
        }),
        signature: b.askerSig,
      });

      // The grant names who may ask. A signature from anyone else is refused.
      if (asker.toLowerCase() !== String(grant.verifier).toLowerCase()) {
        return json(res, 403, {
          error: `this permission was issued to ${grant.verifier}, not to ${asker}`,
        });
      }
      if (grant.usesSpent >= grant.usesAllowed) {
        return json(res, 403, { error: "this permission has no uses left" });
      }

      const out = await openRequest(ctx, {
        grantId: grant.grantId,
        vaultId: grant.vaultId,
        owner: grant.owner,
        asker,
        askerName: grant.verifierName,
        questionSet: grant.questionSet,
        // The verifier's own words, not the grant's suggestion. The grant gives
        // a coarse right; the exact question is theirs and the owner sees it.
        question: b.question || grant.note,
        questionHash: b.questionHash,
        askerSig: hexToBytes(b.askerSig),
        days: 7,
      });
      json(res, 200, { ...out, state: "pending", owner: grant.owner });
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, { error: e.message });
      json(res, 502, { error: scrub(e) });
    }
  },

  /** The owner's inbox. What is waiting on them, right now. */
  "GET /api/inbox": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const owner = url.searchParams.get("owner");
    if (!owner) return json(res, 400, { error: "owner is required" });
    try {
      json(res, 200, { owner, pending: await pendingFor(ctx.reader, owner) });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /** What the verifier polls while they wait. */
  "GET /api/request": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const id = url.searchParams.get("id");
    if (!id) return json(res, 400, { error: "id is required" });
    try {
      const r = await requestById(ctx.reader, id);
      if (!r) return json(res, 404, { error: "that request is gone", expired: true });
      const payload = { ...r };
      if (r.state === "answered" && r.accessId) {
        payload.receipt = await accessById(ctx.reader, r.accessId);
      }
      json(res, 200, payload);
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /**
   * The owner's device answers. It decrypted locally, called the enclave and
   * signed the result - so this endpoint never sees a passphrase, a key or a
   * plaintext, only a signed answer it can verify and pay to record.
   */
  "POST /api/answer": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      const request = await requestById(ctx.reader, b.requestId);
      if (!request) return json(res, 404, { error: "that request is gone", expired: true });
      if (request.state !== "pending") {
        return json(res, 409, { error: `that request is already ${request.state}` });
      }

      const owner = await requireSignature({
        address: b.owner,
        types: AnswerTypes,
        primaryType: "Answer",
        message: answerMessage({
          requestId: b.requestId,
          grantId: request.grantId,
          questionHash: request.questionHash,
          answerHash: b.answerHash,
          enclaveRequestId: b.enclaveRequestId,
        }),
        signature: b.ownerSig,
      });
      if (owner.toLowerCase() !== String(request.owner).toLowerCase()) {
        return json(res, 403, { error: "only the owner of the document may answer" });
      }

      if (b.decision === "refused") {
        await decideRequest(ctx, request.entityKey, { state: "refused" });
        await recordRefusal(ctx, {
          grantId: request.grantId,
          owner,
          asker: request.asker,
          question: request.question,
          questionHash: request.questionHash,
          reason: "owner-declined",
          detail: "The owner saw the request and declined it.",
        }).catch(() => {});
        return json(res, 200, { state: "refused" });
      }

      const grant = await liveGrant(ctx.reader, request.grantId);
      const access = await recordAccess(ctx, {
        grantId: request.grantId,
        vaultId: request.vaultId,
        owner,
        asker: request.asker,
        askerName: request.askerName ?? "",
        question: request.question,
        questionHash: request.questionHash,
        answer: b.answer,
        answerHash: b.answerHash,
        band: b.band ?? "",
        requestId: b.enclaveRequestId ?? "",
        provider: b.provider ?? "0x0000000000000000000000000000000000000000",
        model: b.model ?? "glm-5.3",
        trustMode: "private",
        verification: b.verification ?? "provider-address",
        teeType: b.teeType ?? "",
        latencyMs: b.latencyMs ?? 0,
        askerSig: hexToBytes(b.ownerSig),
      });
      await decideRequest(ctx, request.entityKey, { state: "answered", accessId: access.accessId });
      if (grant) {
        await spendGrant(ctx, grant.entityKey, {
          usesSpent: grant.usesSpent,
          usesAllowed: grant.usesAllowed,
        }).catch(() => {});
      }
      json(res, 200, { state: "answered", ...access });
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, { error: e.message });
      json(res, 502, { error: scrub(e) });
    }
  },

  "POST /api/grant/extend": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      json(res, 200, await extendGrant(ctx, b.entityKey, { days: Number(b.days ?? 7) }));
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "POST /api/grant/revoke": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      json(res, 200, await revokeGrant(ctx, b.entityKey));
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /**
   * Build the exact prompt the browser should send to the enclave, plus the
   * canonical question and its hash. The browser does the HTTP call itself in
   * local mode, so this endpoint hands over instructions, never an answer, and
   * never receives the 0G key.
   */
  /* /api/ask/prepare is deliberately absent.
   *
   * It used to take the decrypted document, narrow it server-side and hand back
   * a prompt. It worked, and it quietly made this process a party that sees your
   * plaintext - the exact thing the product promises it is not. The browser now
   * does all of it (web/src/lib/questions.js) and calls the enclave itself.
   *
   * The hosted relay below still takes plaintext, because there a browser cannot
   * reach 0G at all. That instance says so in a permanent banner.
   */

  /**
   * Hosted relay. Only reachable when the browser could not call 0G itself.
   * Refuses on localhost so the honest path is never silently bypassed.
   */
  "POST /api/ask/relay": async (req, res) => {
    if (isLocalHost(req)) {
      return json(res, 400, {
        error:
          "refusing to relay on localhost - your browser can reach the enclave directly, " +
          "and routing through this process would make it a party that sees your extract",
      });
    }
    const key = process.env.ZEROG_API_KEY;
    if (!key) return json(res, 503, { error: "this instance has no 0G key configured" });
    try {
      const b = await readBody(req);
      const r = await askEnclave({
        plaintext: b.plaintext,
        question: b.question,
        topic: b.questionSet,
        apiKey: key,
      });
      json(res, 200, { ...r, relayed: true, operatorSawExtract: true });
    } catch (e) {
      json(res, 502, { error: String(e.message).slice(0, 300), kind: e.kind ?? "relay" });
    }
  },

  "POST /api/access": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      if (!b.askerSig) {
        return json(res, 400, {
          error: "askerSig is required - the answer is released against the asker's signature",
        });
      }
      const out = await recordAccess(ctx, {
        ...b,
        askerSig: hexToBytes(b.askerSig),
      });
      if (b.grantEntityKey) {
        try {
          await spendGrant(ctx, b.grantEntityKey, {
            usesSpent: b.usesSpent ?? 0,
            usesAllowed: b.usesAllowed ?? 1,
          });
        } catch (e) {
          out.spendWarning = scrub(e);
        }
      }
      json(res, 200, out);
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "POST /api/refusal": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      json(res, 200, await recordRefusal(ctx, await readBody(req)));
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "GET /api/retention": async (req, res) => {
    const s = retention._stats ?? { seen: 0, kept: 0, dropped: 0 };
    json(res, 200, {
      watching: Boolean(unwatch),
      owner: acct?.address ?? null,
      since: retention.since,
      windowMs: Date.now() - retention.since,
      seen: s.seen,
      kept: s.kept,
      dropped: s.dropped,
      extensions: retention.extensions,
      error: retention.error,
      // Stated as what it is: an observation over a window, not a proof for all time.
      statement:
        retention.extensions.length === 0
          ? "No extension of your permissions was observed in this window. A permission that simply expires emits nothing at all."
          : `${retention.extensions.length} of your permissions were extended. Each extension is a signed, public, timestamped act.`,
    });
  },

  "GET /api/accesses": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const owner = url.searchParams.get("owner") ?? acct.address;
    try {
      const [accesses, refusals] = await Promise.all([
        accessesOf(ctx.reader, owner),
        refusalsOf(ctx.reader, owner),
      ]);
      json(res, 200, { owner, accesses, refusals });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },
};

/* ----------------------------------------------------------------- static */

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (!path.extname(rel)) rel += ".html";
  const file = path.join(PUBLIC, rel);
  // Never serve outside the public dir.
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": ext === ".woff2" ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
  } catch {
    // A client-side router owns every non-asset path, so fall back to the app
    // shell rather than 404ing a real route like /vault on a hard refresh.
    try {
      const shell = await readFile(path.join(PUBLIC, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"], "content-length": shell.length });
      res.end(shell);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
        .end("not built yet - run `npm --prefix web run build`, or use `npm start` for dev");
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const key = `${req.method} ${url.pathname}`;
  const handler = routes[key];
  try {
    if (handler) await handler(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: scrub(e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  AskOnly  http://localhost:${PORT}`);
  console.log(`  mode     local - your browser talks to the enclave directly`);
  if (bootError) console.log(`  arkiv    NOT READY: ${bootError}`);
  else console.log(`  arkiv    wallet ${acct.address}`);
  if (wiringError) console.log(`  chain    NOT READY: ${wiringError}`);
  else console.log(`  chain    gate ${addresses.gate} -> ENSv2 ${addresses.ensRegistry}`);
  console.log();
});
