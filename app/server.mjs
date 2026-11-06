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
 *   locally and calls router-api.0g.ai itself. The 0G key it uses is the owner's
 *   own, or the one in this machine's .env, which GET /api/zerog/key hands only to
 *   a page on this machine. Either way no question and no line of the document
 *   passes through here. 0G's gateway allowlists localhost origins, so that direct
 *   call works - which is why there is no relay and no middle.
 *
 * In HOSTED mode (someone opened a deployed copy) the browser CANNOT reach 0G:
 *   the router's CORS preflight rejects non-localhost origins with 403. So the
 *   answer has to be relayed through here, and that makes whoever runs this
 *   process a trusted party who sees the extract. /api/mode reports
 *   `operatorSeesExtract: true` in that case. No screen reads it yet, so the
 *   banner that ought to say so does not exist: do not host this until it does.
 *
 * The ciphertext posted to /api/vault is already encrypted by the browser. This
 * process never has the document key and never attempts to decrypt.
 */

import http from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { clients, account, readOnly, preflight, scrub, FAUCET, StateError } from "../src/arkiv/client.mjs";
import {
  putVault, issueGrant, liveGrant, grantsOf, grantsFor, vaultsOf, vaultCipher, vaultMeta, retireVault,
  accessesOf, refusalsOf, revokeGrant, settleAnswered, settleRefused,
  openRequest, pendingFor, requestById, accessById,
  requestsOfGrant, accessesOfGrant, refusalsOfGrant, openCount,
} from "../src/arkiv/ledger.mjs";
import { MAX_STR } from "../src/arkiv/schema.mjs";
import { watchExtensions } from "../src/arkiv/watch.mjs";
import {
  GrantTypes, GrantTypesV1, RequestTypes, AnswerTypes, DelegationTypes, ForgetTypes, RevokeTypes, PresenceTypes,
  AskKeyTypes, SealTypes,
  grantMessage, requestMessage, answerMessage, delegationMessage, forgetMessage, revokeMessage, presenceMessage,
  askKeyMessage, sealMessage,
  requireSignature, requireParty, requireSessionKey, SignatureError, clientSpec, recordId,
} from "../src/auth/typed.mjs";
import { gateStatus, permissionSurface, mayAsk, addresses, wiringError } from "../src/chain/gate.mjs";
import { TOPICS, sha256hex, cleanBand } from "../src/ask/questions.mjs";
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

/**
 * Is this request from a page on this machine, and only that?
 *
 * isLocalHost alone trusts the Host header, and listen() binds every interface, so
 * it says nothing about who is asking. This also wants the connection itself to be
 * loopback (Vite's proxy is), no reverse proxy in front (those add forwarding
 * headers, and behind one every connection is loopback), and the browser's own
 * word that the page is ours: Origin and Sec-Fetch-Site cannot be set by a script.
 * Any other site's page is refused, and gets no CORS headers to read a reply with.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const APP_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const FORWARDED = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip", "cf-connecting-ip", "true-client-ip"];
const fromThisMachine = (req) => {
  if (!LOOPBACK.has(req.socket.remoteAddress) || !isLocalHost(req)) return false;
  if (FORWARDED.some((h) => req.headers[h] !== undefined)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !APP_ORIGINS.has(origin)) return false;
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin";
};

/** A refused signature, with the code that tells the browser to sign in again. */
const signatureRefused = (e) => (e.code ? { error: e.message, code: e.code } : { error: e.message });
const sigBytes = (hex) => (hex ? hexToBytes(hex) : undefined);

const hexToBytes = (hex) => {
  const h = String(hex).replace(/^0x/, "");
  if (h.length % 2) throw new Error("odd-length hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
};

/* ------------------------------------------------------------------ routes */

/* Bumped whenever the browser depends on a new route. The page compares this and
 * says so when the API is older than it, because a stale server looks exactly
 * like a bug in whatever you happen to be looking at. */
const API_BUILD = 7;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** A question or scope that does not fit is refused, not cut off. Arkiv `str` is
 *  128 bytes, and fitStr() would quietly store half a sentence while the hash and
 *  the signature cover all of it. */
const tooLong = (text) => Buffer.byteLength(String(text ?? "")) > MAX_STR;

/** Can this permission still be used, right now? */
const usable = (g) => Boolean(g) && g.state === "live" && g.diesAt > Date.now();

/* Who is answering at the moment. In memory on purpose: it is a hint for the person
 * asking ("should be quick" or "they are away"), it costs no gas, and only the owner's
 * side can claim it: the key a live permission names, or a live delegation. */
const presence = new Map(); // `${vaultId}|${key}` -> { at, diesAt }. The key "*" is a delegation.
const vaultOwners = new Map(); // vaultId -> owner, so a ping costs no extra read
const PRESENCE_MS = 30_000;
const seen = (k) => {
  const p = presence.get(k);
  return Boolean(p) && Date.now() - p.at < PRESENCE_MS && p.diesAt * 1000 > Date.now();
};
/* Can anything answer this permission right now? The key it names, or a browser the
 * owner delegated the whole document to. Per document was not enough: one open device
 * told every reviewer "answering", whichever device held their key. */
const isAnswering = (g) =>
  Boolean(g) && (seen(`${g.vaultId}|${String(g.sessionKey ?? "").toLowerCase()}`) || seen(`${g.vaultId}|*`));
const forgetPresence = (vaultId) => {
  for (const k of [...presence.keys()]) if (k.startsWith(`${vaultId}|`)) presence.delete(k);
};

/* Limits that belong to the protocol, not to any one screen. */
const MIN_GRANT_MS = 30_000; // shorter than this is over before the write lands
const MAX_GRANT_MS = 31 * 86_400_000; // the app offers a week at most
const ASKED_WITHIN_MS = 10 * 60_000; // a signed question older than this is stale
const ANSWERS = ["yes", "no", "unknown"];
const RECEIPT_KINDS = ["provider-address", "no-lines-matched"];
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const hasControl = (s) => CONTROL.test(String(s ?? ""));
const oneLine = (s) => String(s ?? "").replace(new RegExp(CONTROL.source, "g"), " ").trim();

/* What this process has already done. Arkiv's indexes catch up a moment after a write,
 * so a second copy arriving in that moment is refused here rather than written twice. */
const issuing = new Set(); // grantIds written, or being written
const asking = new Set(); // requestIds written, or being written
const settling = new Set(); // requestIds answered, or being answered
const opening = new Map(); // grantId -> questions being written right now
const ended = new Set(); // grantIds revoked, or deleted along with their document
const spentHere = new Map(); // grantId -> uses spent, as this process last wrote them

/* There is no question count any more, so this is what stops a runaway script.
 * Every question costs us an Arkiv write and the owner a call to 0G, made by their
 * browser automatically. In memory: it is a brake, not a record. */
const WAITING_MAX = 10; // questions waiting on one permission at once
const ASK_WINDOW_MS = 10 * 60_000;
const ASKS_PER_WINDOW = 30; // questions on one permission per window
const recentAsks = new Map(); // grantId -> times of recent questions, ms
/* Questions this process opened in the last two minutes and has not seen answered.
 * Arkiv's count catches up a moment after each write, so questions arriving close
 * together each read a count a few short, and all got in. Whichever is higher wins.
 * Only for the moment the index lags: a question that expires unanswered must not
 * hold a place for good. */
const OPEN_LAG_MS = 120_000;
const openHere = new Map(); // grantId -> Map(requestId -> when it was opened, ms)
const settledHere = (grantId, requestId) => openHere.get(grantId)?.delete(requestId);
const openedLately = (grantId) => {
  const m = openHere.get(grantId);
  if (!m) return 0;
  for (const [id, at] of m) if (Date.now() - at > OPEN_LAG_MS) m.delete(id);
  return m.size;
};

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
      // A key in this machine's .env, which GET /api/zerog/key hands to this machine's page.
      machineHasZeroGKey: local && Boolean(process.env.ZEROG_API_KEY),
      note: local
        ? "Your browser calls the enclave directly, with your 0G key or this machine's. This server takes no part in answering."
        : "This hosted instance relays the question to the enclave with its own key, so whoever runs it can see the extract. Run it locally and nobody can.",
      zerogBase: baseUrl(),
      model: DEFAULT_MODEL,
      pinnedProvider: PINNED_PROVIDER,
      minMaxTokens: MIN_MAX_TOKENS,
    });
  },

  /**
   * The 0G key from this machine's .env, for this machine's own page, so the owner
   * is not asked to paste a key the machine already has. The browser still makes
   * the enclave call itself, so this hands over a key and sees no question and no
   * line of the document. Anyone else gets the same 404 as no key at all.
   */
  "GET /api/zerog/key": async (req, res) => {
    const key = process.env.ZEROG_API_KEY;
    if (!key || !fromThisMachine(req)) return json(res, 404, { error: "no 0G key here" });
    json(res, 200, { key });
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
      build: API_BUILD,
      mode: isLocalHost(req) ? "local" : "hosted",
      chain,
      arkiv,
      questionSets: Object.fromEntries(
        Object.entries(TOPICS).map(([k, v]) => [
          k,
          { label: v.label, blurb: v.blurb, examples: v.examples },
        ]),
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
      const label = String(b.label ?? "Untitled document");
      if (tooLong(label) || hasControl(label)) {
        return json(res, 400, { error: "keep the name to one line, under about 120 characters" });
      }
      const cipher = hexToBytes(b.cipher);
      /* Signed, so nobody can put a document in someone else's list. The hash is of
       * the bytes we were sent, not the one the body claims. */
      const sha256 = createHash("sha256").update(cipher).digest("hex");
      if (String(b.sha256 ?? "").toLowerCase() !== sha256) {
        return json(res, 400, { error: "that document is not the one that was signed" });
      }
      const signed = await requireParty({
        address: b.owner,
        types: SealTypes,
        primaryType: "Seal",
        message: sealMessage({ sha256, label }),
        signature: b.ownerSig,
        session: b.session,
      });
      const out = await putVault(ctx, {
        owner: signed.party,
        label,
        docKind: b.docKind ?? "other",
        sha256,
        iv: b.iv ?? "",
        cipher,
        days: Number(b.days ?? 180),
        ownerSig: hexToBytes(b.ownerSig),
        ownerKey: signed.key,
        ownerKeyDiesAt: signed.keyDiesAt,
        ownerKeySig: sigBytes(signed.keySig),
      });
      json(res, 200, out);
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
      json(res, 502, { error: scrub(e) });
    }
  },

  /* ----------------------------------------------------------- delete ---
     The owner signs the vaultId, and the signature is checked against the OWNER
     RECORDED ON THE VAULT, not against whatever address the body claims, before
     any gas is spent. The server can pay for a deletion. It can neither author
     nor target one. */
  "POST /api/vault/forget": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      if (!b.vaultId) return json(res, 400, { error: "which document?" });

      const { party: signer } = await requireParty({
        address: b.owner,
        types: ForgetTypes,
        primaryType: "Forget",
        message: forgetMessage({ vaultId: b.vaultId }),
        signature: b.ownerSig,
        session: b.session,
      });

      const meta = await vaultMeta(ctx.reader, b.vaultId);
      if (!meta) return json(res, 404, { error: "no such document" });
      if (String(meta.owner).toLowerCase() !== String(signer).toLowerCase()) {
        return json(res, 403, { error: "that document belongs to someone else" });
      }
      if (meta.state !== "live") return json(res, 409, { error: "it is already gone" });

      // A permission to ask about a document that no longer exists would leave
      // someone waiting forever, so the permissions end with it, atomically.
      const pointing = (await grantsOf(ctx.reader, signer, 100)).filter(
        (g) => g.vaultId === meta.vaultId && g.state === "live",
      );
      // Over from this moment: an answer still waiting its turn to be written is refused.
      for (const g of pointing) ended.add(g.grantId);
      let out;
      try {
        out = await retireVault(ctx, meta.entityKey, pointing.map((g) => g.entityKey));
      } catch (e) {
        for (const g of pointing) ended.delete(g.grantId);
        throw e;
      }
      forgetPresence(meta.vaultId);

      json(res, 200, { ...out, vaultId: meta.vaultId, label: meta.label, endedPermissions: pointing.length });
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
      json(res, 502, { error: scrub(e) });
    }
  },

  "GET /api/grants": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const verifier = url.searchParams.get("verifier");
    const owner = url.searchParams.get("owner") ?? acct.address;
    try {
      if (verifier) {
        json(res, 200, { verifier, grants: await grantsFor(ctx.reader, verifier) });
      } else {
        json(res, 200, { owner, grants: await grantsOf(ctx.reader, owner) });
      }
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
      json(res, 200, { ...g, answering: isAnswering(g) });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  "POST /api/grant": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    let claimed = null;
    try {
      const b = await readBody(req);
      // questionSet is a coarse tag derived from the owner's own words, not a
      // choice from a fixed menu - it only exists to pick an ENSv2 role bit.
      // Rejecting anything outside a hardcoded list would put the limit back.
      if (!b.question?.trim()) {
        return json(res, 400, { error: "say what they may ask about" });
      }
      if (tooLong(b.question) || tooLong(b.questionSet)) {
        return json(res, 400, { error: "that is too long to store, keep it under about 120 characters" });
      }
      if (hasControl(b.question)) {
        return json(res, 400, { error: "keep what they may ask about to one line" });
      }
      if (!HEX_ADDRESS.test(String(b.verifier ?? "")) || (b.sessionKey && !HEX_ADDRESS.test(String(b.sessionKey)))) {
        return json(res, 400, { error: "that is not a wallet address" });
      }

      /* It lasts exactly as long as the owner signed for. This used to come from
       * `minutes` and `days`, which nobody signs, so the signed time was checked and
       * then ignored, and a two-minute signature could be posted again for six months. */
      const diesAt = Number(b.diesAt);
      const life = diesAt - Date.now();
      if (!Number.isSafeInteger(diesAt) || life < MIN_GRANT_MS) {
        return json(res, 400, { error: "that permission would be over before it starts" });
      }
      if (life > MAX_GRANT_MS) {
        return json(res, 400, { error: "a permission can last a month at most" });
      }
      /* No count. A body that still carries usesAllowed was signed under the old
       * counted type, by a tab with an older bundle or by a script, and is checked
       * against exactly that. */
      const counted = b.usesAllowed !== undefined && b.usesAllowed !== null;
      const usesAllowed = counted ? Number(b.usesAllowed) : 0;
      if (counted && (!Number.isSafeInteger(usesAllowed) || usesAllowed < 1)) {
        return json(res, 400, { error: "say how many questions they may ask" });
      }
      const types = counted ? GrantTypesV1 : GrantTypes;

      // The owner signed these exact terms. Verify before spending our gas on
      // them - this is what makes the paymaster arrangement honest.
      const message = grantMessage({
        vaultId: b.vaultId,
        verifier: b.verifier,
        questionSet: b.questionSet,
        question: b.question,
        usesAllowed: counted ? usesAllowed : undefined,
        diesAt,
        sessionKey: b.sessionKey,
      });
      const signed = await requireParty({
        address: b.owner,
        types,
        primaryType: "Grant",
        message,
        signature: b.ownerSig,
        session: b.session,
      });
      const owner = signed.party;

      // Only over a document of their own that still exists. Anyone could sign a
      // permission over somebody else's document, and use it to claim to be answering.
      const meta = await vaultMeta(ctx.reader, message.vaultId);
      if (!meta || meta.state !== "live") {
        return json(res, 404, { error: "that document does not exist, or it was deleted" });
      }
      if (String(meta.owner).toLowerCase() !== owner.toLowerCase()) {
        return json(res, 403, { error: "that document belongs to someone else" });
      }

      // One signature makes one permission, however many times it is posted.
      const grantId = recordId("g", types, "Grant", message);
      if (issuing.has(grantId)) return json(res, 409, { error: "this permission was already issued" });
      issuing.add(grantId);
      claimed = grantId;
      if (await liveGrant(ctx.reader, grantId)) {
        claimed = null; // it exists, so it stays refused
        return json(res, 409, { error: "this permission was already issued" });
      }

      const out = await issueGrant(ctx, {
        grantId,
        diesAt,
        vaultId: message.vaultId,
        owner,
        verifier: message.verifier,
        verifierName: oneLine(b.verifierName),
        questionSet: message.questionSet,
        usesAllowed,
        threshold: String(b.threshold ?? ""),
        note: message.question,
        labelId: 0n,
        ownerSig: hexToBytes(b.ownerSig),
        sessionKey: b.sessionKey ? message.sessionKey : "",
        ownerKey: signed.key,
        ownerKeyDiesAt: signed.keyDiesAt,
        ownerKeySig: sigBytes(signed.keySig),
      });
      claimed = null; // written, and it stays in `issuing` so a copy is refused here too
      json(res, 200, { ...out, diesAt });
    } catch (e) {
      if (claimed) issuing.delete(claimed); // never written, so it may be tried again
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
      json(res, 502, { error: scrub(e) });
    }
  },

  /* -------------------------------------------------- the second party ---
     A verifier cannot answer, only ask. This writes a pending request into
     the owner's inbox, signed by the asker before they are told anything. */
  "POST /api/request": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    let claimed = null;
    try {
      const b = await readBody(req);
      const grant = await liveGrant(ctx.reader, String(b.grantId ?? ""));
      if (!grant) {
        return json(res, 404, {
          error: "that permission no longer exists",
          expired: true,
          explain: "Past its death block Arkiv stops returning the entity and every operation fails.",
        });
      }

      /* The time is part of what the asker signed, and a signature only counts while
       * it is fresh. Every signed question is public, and each one was good for posting
       * again until the limit ran out. */
      const askedAt = Number(b.askedAt);
      if (!Number.isSafeInteger(askedAt) || Math.abs(Date.now() - askedAt) > ASKED_WITHIN_MS) {
        return json(res, 400, { error: "that question was signed too long ago, so ask it again" });
      }
      const message = requestMessage({ grantId: grant.grantId, questionHash: b.questionHash, askedAt });

      /* Signed by the reviewer's wallet; by a key their wallet let sign for them in this
       * browser for a week (a session); or by a key it let sign under exactly this
       * permission until it ends. Either way the question is theirs, and asking is no
       * longer a wallet popup every time. */
      let asker;
      let askerKey = "";
      let askKeySig = null;
      let askKeyDiesAt = 0;
      if (b.session) {
        const signed = await requireParty({
          address: b.asker ?? grant.verifier,
          types: RequestTypes,
          primaryType: "Request",
          message,
          signature: b.askerSig,
          session: b.session,
        });
        asker = signed.party;
        askerKey = signed.key;
        askKeySig = signed.keySig;
        askKeyDiesAt = signed.keyDiesAt;
      } else if (b.askerKey) {
        if (!HEX_ADDRESS.test(String(b.askerKey))) return json(res, 400, { error: "that is not a key" });
        askerKey = await requireSignature({
          address: b.askerKey,
          types: RequestTypes,
          primaryType: "Request",
          message,
          signature: b.askerSig,
        });
        asker = await requireSignature({
          address: grant.verifier,
          types: AskKeyTypes,
          primaryType: "AskKey",
          message: askKeyMessage({ grantId: grant.grantId, sessionKey: askerKey, diesAt: grant.diesAt }),
          signature: b.askKeySig,
        });
        askKeySig = b.askKeySig;
      } else {
        asker = await requireSignature({
          address: b.asker,
          types: RequestTypes,
          primaryType: "Request",
          message,
          signature: b.askerSig,
        });
      }

      // The grant names who may ask. A signature from anyone else is refused.
      if (asker.toLowerCase() !== String(grant.verifier).toLowerCase()) {
        return json(res, 403, {
          error: `this permission was issued to ${grant.verifier}, not to ${asker}`,
        });
      }
      if (grant.state === "revoked" || ended.has(grant.grantId)) {
        return json(res, 403, { error: "the owner ended this permission" });
      }
      if (grant.diesAt <= Date.now()) {
        return json(res, 404, { error: "that permission no longer exists", expired: true });
      }

      const asked = String(b.question ?? "").trim();
      if (!asked) return json(res, 400, { error: "write the question first" });
      if (tooLong(asked)) {
        return json(res, 400, { error: "that question is too long, keep it under about 120 characters" });
      }
      // A line break would let a question write its own "ALLOWED TOPIC:" into the prompt.
      if (hasControl(asked)) return json(res, 400, { error: "keep the question to one line" });
      // What gets answered has to be what got signed.
      if ((await sha256hex(asked)) !== b.questionHash) {
        return json(res, 400, { error: "that question does not match the one you signed" });
      }

      // One signed question makes one question.
      const requestId = recordId("q", RequestTypes, "Request", message);
      if (asking.has(requestId)) return json(res, 409, { error: "that question was already asked" });
      asking.add(requestId);
      claimed = requestId;
      if (await requestById(ctx.reader, requestId)) {
        claimed = null;
        return json(res, 409, { error: "that question was already asked" });
      }

      // An old counted grant can have run out.
      if (grant.state !== "live") {
        asking.delete(requestId);
        claimed = null;
        return json(res, 403, { error: "this permission has run out" });
      }

      /* No count, but a brake. Questions still waiting are counted rather than listed,
       * because a list stops at 50. A refusal here un-claims the id: the same signed
       * question may be posted again once there is room. */
      const busy = (status, error, retryAfterMs) => {
        asking.delete(requestId);
        claimed = null;
        json(res, status, { error, retryAfterMs: Math.max(1000, Math.ceil(retryAfterMs)) });
      };
      const waiting =
        Math.max(await openCount(ctx.reader, grant.grantId), openedLately(grant.grantId)) +
        (opening.get(grant.grantId) ?? 0);
      // Only an old grant carries a count, and it holds to the one its owner signed.
      if (grant.usesAllowed > 0) {
        const spent = Math.max(grant.usesSpent, spentHere.get(grant.grantId) ?? 0);
        if (spent + waiting >= grant.usesAllowed) {
          asking.delete(requestId);
          claimed = null;
          return json(res, 403, { error: `you have used all ${grant.usesAllowed} of your questions` });
        }
      }
      if (waiting >= WAITING_MAX) {
        return busy(429, `${WAITING_MAX} of your questions are still waiting. Ask again once one is answered.`, 15_000);
      }
      const t = Date.now();
      const recent = (recentAsks.get(grant.grantId) ?? []).filter((at) => t - at < ASK_WINDOW_MS);
      if (recent.length >= ASKS_PER_WINDOW) {
        return busy(429, "That's a lot of questions in a few minutes. Try again shortly.", recent[0] + ASK_WINDOW_MS - t);
      }
      recent.push(t);
      recentAsks.set(grant.grantId, recent);

      opening.set(grant.grantId, (opening.get(grant.grantId) ?? 0) + 1);
      let out;
      try {
        out = await openRequest(ctx, {
          requestId,
          askedAt,
          grantId: grant.grantId,
          vaultId: grant.vaultId,
          owner: grant.owner,
          asker,
          askerName: grant.verifierName,
          questionSet: grant.questionSet,
          // The asker's own words. The grant gives a coarse right; the exact
          // question is theirs.
          question: asked,
          questionHash: b.questionHash,
          askerSig: hexToBytes(b.askerSig),
          askerKey,
          askKeySig: askerKey ? sigBytes(askKeySig) : undefined,
          askKeyDiesAt,
          days: 7,
        });
      } catch (e) {
        // Never written, so it does not count towards the brake either.
        const i = recent.lastIndexOf(t);
        if (i >= 0) recent.splice(i, 1);
        throw e;
      } finally {
        opening.set(grant.grantId, opening.get(grant.grantId) - 1);
      }
      claimed = null;
      if (!openHere.has(grant.grantId)) openHere.set(grant.grantId, new Map());
      openHere.get(grant.grantId).set(requestId, Date.now());
      json(res, 200, { ...out, state: "pending", owner: grant.owner });
    } catch (e) {
      if (claimed) asking.delete(claimed);
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
      json(res, 502, { error: scrub(e) });
    }
  },

  /**
   * What is waiting on the owner, right now.
   *
   * A question outlives its permission (it stays readable for the asker for a
   * week), so without this filter a ten-minute permission left a question sitting
   * here for seven days that nobody was entitled to have answered. Only questions
   * whose permission can still be used come back, each with the owner's own words
   * for what was allowed, because that is what the answer is checked against.
   */
  "GET /api/inbox": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const owner = url.searchParams.get("owner");
    if (!owner) return json(res, 400, { error: "owner is required" });
    try {
      const [pending, grants] = await Promise.all([
        pendingFor(ctx.reader, owner, 100),
        grantsOf(ctx.reader, owner, 100),
      ]);
      const byId = new Map(grants.map((g) => [g.grantId, g]));
      json(res, 200, {
        owner,
        // Each carries the asker's signature and the time they signed, so the owner's
        // browser can check that someone it permitted really asked, without trusting us.
        pending: pending
          .filter((r) => usable(byId.get(r.grantId)) && !ended.has(r.grantId))
          .map((r) => ({ ...r, scope: byId.get(r.grantId).note ?? "" })),
      });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /**
   * Every question under one permission, with what came back. This is the asker's
   * page: several can be open at once and a reload loses nothing.
   */
  "GET /api/requests": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const grantId = url.searchParams.get("grant");
    if (!grantId) return json(res, 400, { error: "grant is required" });
    try {
      const [requests, accesses, refusals] = await Promise.all([
        requestsOfGrant(ctx.reader, grantId),
        accessesOfGrant(ctx.reader, grantId),
        refusalsOfGrant(ctx.reader, grantId),
      ]);
      const receipts = new Map(accesses.map((a) => [a.accessId, a]));
      const reasons = new Map(refusals.map((r) => [r.questionHash, r]));
      json(res, 200, {
        grantId,
        requests: requests.map(({ entityKey, ...r }) => ({
          ...r,
          receipt: r.state === "answered" ? (receipts.get(r.accessId) ?? null) : null,
          refusal: r.state === "refused" ? (reasons.get(r.questionHash) ?? null) : null,
        })),
      });
    } catch (e) {
      json(res, 502, { error: scrub(e) });
    }
  },

  /**
   * "I am answering right now." Sent by the owner's tab while it answers by itself,
   * so the asker can be told whether to expect a quick reply. Either the key a live
   * permission names, proving it holds that key, or a live delegation signed by the
   * document's owner. Nothing is written anywhere.
   */
  "POST /api/presence": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);

      // A key named by a live permission. The tab proves it holds that key.
      if (b.grantId) {
        const at = Number(b.at);
        if (!(Math.abs(Date.now() - at) < 120_000)) return json(res, 401, { error: "that is too old to count" });
        const signer = await requireSignature({
          address: b.sessionKey,
          types: PresenceTypes,
          primaryType: "Presence",
          message: presenceMessage({ grantId: b.grantId, at }),
          signature: b.sig,
        });
        const grant = await liveGrant(ctx.reader, b.grantId);
        if (
          !usable(grant) ||
          ended.has(grant.grantId) ||
          String(grant.sessionKey).toLowerCase() !== String(signer).toLowerCase()
        ) {
          return json(res, 403, { error: "that key is not named by a live permission" });
        }
        const k = `${grant.vaultId}|${signer.toLowerCase()}`;
        if (b.stop) presence.delete(k);
        else presence.set(k, { at: Date.now(), diesAt: Math.floor(grant.diesAt / 1000) });
        return json(res, 200, { answering: isAnswering(grant) });
      }

      const ownerOf = async (vaultId) => {
        let owner = vaultOwners.get(vaultId);
        if (!owner) {
          const meta = await vaultMeta(ctx.reader, vaultId);
          if (!meta) return null;
          owner = meta.owner;
          vaultOwners.set(vaultId, owner);
        }
        return owner;
      };

      // A browser the owner signed in, answering for every permission on a document
      // it has unlocked. The session must be the document owner's.
      if (b.session) {
        if (!b.vaultId) return json(res, 400, { error: "which document?" });
        const owner = await ownerOf(String(b.vaultId));
        if (!owner) return json(res, 404, { error: "no such document" });
        const signed = await requireSessionKey({ party: owner, session: b.session });
        const k = `${b.vaultId}|*`;
        if (b.stop) presence.delete(k);
        else presence.set(k, { at: Date.now(), diesAt: signed.keyDiesAt });
        return json(res, 200, { answering: seen(k) });
      }

      // A delegation, from a browser that unlocked the document after the fact. It
      // answers for every permission on that document.
      const { delegation: d, stop } = b;
      if (!d?.vaultId) return json(res, 400, { error: "delegation is required" });
      const signer = await requireSignature({
        address: d.owner,
        types: DelegationTypes,
        primaryType: "Delegation",
        message: delegationMessage({ vaultId: d.vaultId, sessionKey: d.sessionKey, diesAt: d.diesAt }),
        signature: d.sig,
      });
      const owner = await ownerOf(String(d.vaultId));
      if (!owner) return json(res, 404, { error: "no such document" });
      if (String(owner).toLowerCase() !== String(signer).toLowerCase()) {
        return json(res, 403, { error: "that document belongs to someone else" });
      }
      const k = `${d.vaultId}|*`;
      if (stop || Number(d.diesAt) * 1000 <= Date.now()) presence.delete(k);
      else presence.set(k, { at: Date.now(), diesAt: Number(d.diesAt) });
      json(res, 200, { answering: seen(k) });
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
      json(res, 502, { error: scrub(e) });
    }
  },

  /** One question, by id. */
  "GET /api/request": async (req, res, url) => {
    if (!ctx) return json(res, 503, { error: bootError });
    const id = url.searchParams.get("id");
    if (!id) return json(res, 400, { error: "id is required" });
    try {
      const r = await requestById(ctx.reader, id);
      if (!r) return json(res, 404, { error: "that request is gone", expired: true });
      const payload = { ...r };
      if (r.state === "answered" && r.accessId) {
        // The receipt carries the verdict; the question lives on the request.
        // A bare "YES" with no question above it is unreadable once the asker
        // has asked more than one thing.
        const receipt = await accessById(ctx.reader, r.accessId);
        payload.receipt = receipt ? { ...receipt, question: r.question } : receipt;
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
    let claimed = null;
    try {
      const b = await readBody(req);
      const request = await requestById(ctx.reader, String(b.requestId ?? ""));
      if (!request) return json(res, 404, { error: "that request is gone", expired: true });
      if (request.state !== "pending") {
        return json(res, 409, { error: `that request is already ${request.state}` });
      }

      /* Who signed this answer? Usually the key the owner named in the permission, held
       * in their browser, so one signature when the reviewer was added covers every
       * answer. Otherwise the owner's wallet, or a key the owner delegated this document
       * to. Each path ends at the same question: does this trace back to the owner of
       * THIS document? */
      const signer = await requireSignature({
        address: b.signer ?? b.owner,
        types: AnswerTypes,
        primaryType: "Answer",
        message: answerMessage({
          requestId: request.requestId,
          grantId: request.grantId,
          questionHash: request.questionHash,
          answerHash: b.answerHash,
          enclaveRequestId: b.enclaveRequestId,
        }),
        signature: b.ownerSig,
      });

      // Ended means ended, whatever the verdict. A refusal spends a use too, and was
      // still being written against permissions the owner had already ended.
      const grant = await liveGrant(ctx.reader, request.grantId);
      if (!usable(grant) || ended.has(request.grantId)) {
        return json(res, 410, { error: "that permission has ended, so this can no longer be answered" });
      }

      const namedKey =
        Boolean(grant.sessionKey) && String(grant.sessionKey).toLowerCase() === signer.toLowerCase();
      let owner = namedKey ? grant.owner : signer;
      // A delegation only matters for a key the permission does not name. An expired
      // one sent along with a named key used to block it.
      if (!namedKey && b.delegation) {
        const d = b.delegation;
        const delegator = await requireSignature({
          address: d.owner,
          types: DelegationTypes,
          primaryType: "Delegation",
          message: delegationMessage({
            vaultId: d.vaultId,
            sessionKey: d.sessionKey,
            diesAt: d.diesAt,
          }),
          signature: d.sig,
        });
        if (String(d.sessionKey).toLowerCase() !== signer.toLowerCase()) {
          return json(res, 403, { error: "that delegation does not name the key that signed" });
        }
        if (String(d.vaultId) !== String(request.vaultId)) {
          return json(res, 403, { error: "that delegation is for a different document" });
        }
        if (Number(d.diesAt) * 1000 <= Date.now()) {
          return json(res, 403, { error: "that delegation has expired" });
        }
        owner = delegator;
      } else if (!namedKey && b.session) {
        // A browser the document's owner signed in, so no delegation popup per document.
        const signed = await requireSessionKey({ party: request.owner, session: b.session });
        if (signed.key.toLowerCase() !== signer.toLowerCase()) {
          return json(res, 403, { error: "that sign-in does not name the key that signed" });
        }
        owner = signed.party;
      }
      if (owner.toLowerCase() !== String(request.owner).toLowerCase()) {
        return json(res, 403, { error: "only the owner of the document may answer" });
      }

      /* The verdict has to be the one that was signed. The signature covers answerHash,
       * and nothing compared it with the answer it arrived with, so "no" could be signed
       * and "yes" recorded, or a signed refusal recorded as an answer. */
      let verdict = null;
      if (b.decision === "refused") {
        if (b.answerHash || b.enclaveRequestId) {
          return json(res, 400, { error: "a question that was turned down carries no answer" });
        }
      } else if (b.decision === "answered") {
        const answer = String(b.answer ?? "");
        const band = String(b.band ?? "");
        if (!ANSWERS.includes(answer)) return json(res, 400, { error: "an answer is yes, no or unknown" });
        if (band !== cleanBand(band)) return json(res, 400, { error: "that band is not one AskOnly sends" });
        if (!b.answerHash || (await sha256hex(JSON.stringify({ answer, band }))) !== b.answerHash) {
          return json(res, 400, { error: "that answer is not the one that was signed" });
        }
        verdict = { answer, band };
      } else {
        return json(res, 400, { error: "decision is answered or refused" });
      }

      // A second copy of this answer, from another tab or another device, stops here.
      if (settling.has(request.requestId)) {
        return json(res, 409, { error: "that request is already being answered" });
      }
      settling.add(request.requestId);
      claimed = request.requestId;

      /* Checked again inside the write's own turn. Writes queue behind each other, and a
       * revoke, or another answer to the same question, could land while this waited.
       * The grant is read fresh for the same reason: two answers under one permission
       * both wrote "one use spent". */
      const prepare = async () => {
        const r = await requestById(ctx.reader, request.requestId);
        if (!r) throw new StateError("that request is gone", 404);
        if (r.state !== "pending") throw new StateError(`that request is already ${r.state}`, 409);
        const g = await liveGrant(ctx.reader, r.grantId);
        if (!usable(g) || ended.has(r.grantId)) {
          throw new StateError("that permission has ended, so this can no longer be answered", 410);
        }
        return { request: r, grant: { ...g, usesSpent: Math.max(g.usesSpent, spentHere.get(g.grantId) ?? 0) } };
      };

      if (!verdict) {
        const outOfScope = b.reason === "out-of-scope";
        const out = await settleRefused(ctx, {
          prepare,
          refusal: {
            grantId: request.grantId,
            owner,
            asker: request.asker,
            question: request.question,
            questionHash: request.questionHash,
            reason: outOfScope ? "out-of-scope" : "owner-declined",
            detail: outOfScope
              ? "Outside what the owner agreed to be asked about."
              : "The owner saw the question and turned it down.",
          },
        });
        spentHere.set(request.grantId, out.grant.usesSpent + 1);
        settledHere(request.grantId, request.requestId);
        claimed = null;
        return json(res, 200, { state: "refused" });
      }

      const { grant: settled, ...receipt } = await settleAnswered(ctx, {
        prepare,
        access: {
          grantId: request.grantId,
          vaultId: request.vaultId,
          owner,
          asker: request.asker,
          askerName: request.askerName ?? "",
          question: request.question,
          questionHash: request.questionHash,
          answer: verdict.answer,
          answerHash: b.answerHash,
          band: verdict.band,
          requestId: String(b.enclaveRequestId ?? ""),
          // "" when the browser had no provider to name, and addr("") throws, which left
          // the question stuck after the enclave had already been asked.
          provider: HEX_ADDRESS.test(String(b.provider ?? "")) ? b.provider : ZERO_ADDRESS,
          model: String(b.model || "glm-5.3"),
          trustMode: "private",
          verification: RECEIPT_KINDS.includes(b.verification) ? b.verification : "provider-address",
          teeType: String(b.teeType ?? ""),
          linesSeen: /^\d+\/\d+$/.test(String(b.linesSeen ?? "")) ? String(b.linesSeen) : "",
          latencyMs: Math.max(0, Math.min(3_600_000, Math.round(Number(b.latencyMs) || 0))),
          askerSig: hexToBytes(b.ownerSig),
        },
      });
      spentHere.set(request.grantId, settled.usesSpent + 1);
      settledHere(request.grantId, request.requestId);
      claimed = null;
      json(res, 200, { state: "answered", ...receipt });
    } catch (e) {
      if (claimed) settling.delete(claimed);
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
      if (e instanceof StateError) return json(res, e.status, { error: e.message });
      json(res, 502, { error: scrub(e) });
    }
  },

  /**
   * End a permission. Signed: this took an entityKey from whoever POSTed it, so
   * anybody could end anybody's permission.
   */
  "POST /api/grant/revoke": async (req, res) => {
    if (!ctx) return json(res, 503, { error: bootError });
    try {
      const b = await readBody(req);
      if (!b.grantId) return json(res, 400, { error: "which permission?" });
      const { party: signer } = await requireParty({
        address: b.owner,
        types: RevokeTypes,
        primaryType: "Revoke",
        message: revokeMessage({ grantId: b.grantId }),
        signature: b.ownerSig,
        session: b.session,
      });
      const grant = await liveGrant(ctx.reader, b.grantId);
      if (!grant) return json(res, 404, { error: "that permission has already ended", expired: true });
      if (String(grant.owner).toLowerCase() !== String(signer).toLowerCase()) {
        return json(res, 403, { error: "that permission belongs to someone else" });
      }
      // Over from this moment: an answer still waiting its turn to be written is refused.
      ended.add(grant.grantId);
      try {
        json(res, 200, await revokeGrant(ctx, grant.entityKey));
      } catch (e) {
        ended.delete(grant.grantId);
        throw e;
      }
    } catch (e) {
      if (e instanceof SignatureError) return json(res, 401, signatureRefused(e));
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
    // An /api path that does not exist must say so. Falling through to the
    // single-page fallback returned the app shell with a 200, so a removed or
    // mistyped endpoint looked like it was working.
    else if (url.pathname.startsWith("/api/")) {
      json(res, 404, { error: `no such endpoint: ${req.method} ${url.pathname}` });
    } else await serveStatic(req, res, url);
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
