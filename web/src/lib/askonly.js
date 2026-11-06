/**
 * AskOnly — the client side of the protocol.
 *
 * Three things live here and nowhere else:
 *   1. document encryption, which happens in this page and only this page
 *   2. the EIP-712 payloads, which must match the server byte for byte
 *   3. the direct call to the enclave, which never goes through our server
 */

import { verifyTypedData, getAddress } from "viem";

import { cleanBand, WHYS } from "./questions.js";

/* ------------------------------------------------------------------ api -- */

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method: body ? "POST" : method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* -------------------------------------------------------------- crypto -- */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h) => {
  const s = String(h).replace(/^0x/, "");
  const o = new Uint8Array(s.length / 2);
  for (let i = 0; i < o.length; i += 1) o[i] = parseInt(s.substr(i * 2, 2), 16);
  return o;
};
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** 210,000 iterations - OWASP's floor for PBKDF2-SHA256, and the passphrase is
 *  the only thing between a stolen ciphertext and the document. */
async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptDocument(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));
  const cipher = new Uint8Array(salt.length + sealed.length);
  cipher.set(salt, 0);
  cipher.set(sealed, salt.length);
  if (cipher.length > 128 * 1024) {
    throw new Error(`this encrypts to ${(cipher.length / 1024).toFixed(1)} KiB; Arkiv allows 128 KiB per write`);
  }
  return {
    cipherHex: `0x${toHex(cipher)}`,
    iv: b64(iv),
    // Of the ciphertext. It is public, and a hash of the plaintext of a short or
    // templated document could be checked against guesses, offline.
    sha256: toHex(await crypto.subtle.digest("SHA-256", cipher)),
    bytesLen: cipher.length,
  };
}

/** Open with a key already derived. */
export async function decryptWithKey(cipherHex, ivB64, key) {
  const bytes = fromHex(cipherHex);
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, bytes.slice(16)));
  } catch {
    // AES-GCM fails authentication rather than returning garbage, which is what
    // we want: a wrong passphrase is a refusal, not a corrupt read.
    throw new Error("wrong passphrase, or this ciphertext has been altered");
  }
}

/** The passphrase path, handing back the key as well as the text. The key is
 *  non-extractable, so no script can read its bytes out. keystore.js says what that
 *  does not cover once it is kept for answering. */
export async function openDocument(cipherHex, ivB64, passphrase) {
  const key = await deriveKey(passphrase, fromHex(cipherHex).slice(0, 16));
  return { plaintext: await decryptWithKey(cipherHex, ivB64, key), key };
}

export async function decryptDocument(cipherHex, ivB64, passphrase) {
  return (await openDocument(cipherHex, ivB64, passphrase)).plaintext;
}

/* ------------------------------------------------------------- EIP-712 -- */

/* Name and version only - no chainId. Must match src/auth/typed.mjs exactly
 * or every signature fails verification. Chain-agnostic so any wallet on any
 * network can sign without being asked to switch. */
export const DOMAIN = { name: "AskOnly", version: "1" };

export const TYPES = {
  Grant: [
    { name: "vaultId", type: "string" },
    { name: "verifier", type: "address" },
    { name: "questionSet", type: "string" },
    { name: "question", type: "string" },
    { name: "usesAllowed", type: "uint256" },
    { name: "diesAt", type: "uint256" },
    { name: "sessionKey", type: "address" },
    { name: "statement", type: "string" },
  ],
  Request: [
    { name: "grantId", type: "string" },
    { name: "questionHash", type: "string" },
    { name: "askedAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
  Answer: [
    { name: "requestId", type: "string" },
    { name: "grantId", type: "string" },
    { name: "questionHash", type: "string" },
    { name: "answerHash", type: "string" },
    { name: "enclaveRequestId", type: "string" },
    { name: "statement", type: "string" },
  ],
  Delegation: [
    { name: "vaultId", type: "string" },
    { name: "sessionKey", type: "address" },
    { name: "diesAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
  // Forget and Revoke mirror src/auth/typed.mjs. Change one, change both.
  Forget: [
    { name: "vaultId", type: "string" },
    { name: "statement", type: "string" },
  ],
  Revoke: [
    { name: "grantId", type: "string" },
    { name: "statement", type: "string" },
  ],
  Presence: [
    { name: "grantId", type: "string" },
    { name: "at", type: "uint256" },
  ],
  AskKey: [
    { name: "grantId", type: "string" },
    { name: "sessionKey", type: "address" },
    { name: "diesAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
};

/** The line each signer actually reads in their wallet. */

export const STATEMENTS = {
  grant: "I allow this person to ask about my document until this expires, and my browser to answer them.",
  request: "I am asking this question, and I accept that it is recorded against me.",
  answer: "My device answered this question. Only the enclave read any of the document.",
  delegation:
    "I let this browser answer questions about this one document on my behalf, until it expires.",
  forget:
    "I am deleting this document. Anyone who could ask about it can no longer ask.",
  revoke: "I am ending this permission. They can ask nothing more.",
  askKey: "I let this browser sign my questions under this one permission, until it expires.",
};

/* -------------------------------------------------------------- enclave -- */

const ZG_BASE = "https://router-api.0g.ai/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Which machines may answer. Read live, cached for a minute, because a provider
 * going unhealthy mid-session has to be noticed but not on every question. From
 * 0G directly with the owner's key, so answering still does not depend on our
 * server; our own /api/providers is only the fallback. */
let providerCache = { at: 0, list: null };
async function enclaveProviders(model, apiKey) {
  if (providerCache.list && Date.now() - providerCache.at < 60_000) return providerCache.list;
  let list = null;
  try {
    const res = await fetch(`${ZG_BASE}/providers?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const { data = [] } = await res.json();
      list = data.map((p) => ({
        address: p.address,
        verifiability: p.verifiability ?? null,
        teeType: p.tee_type ?? null,
        teeVerifier: p.tee_verifier ?? null,
      }));
    }
  } catch {
    /* fall through to our copy of the same list */
  }
  if (!list) list = (await api("/api/providers").catch(() => ({}))).providers ?? [];
  // An empty list is never kept. One failed read used to cache "no machines" for a
  // minute, and every answer bought in that minute was thrown away.
  if (list.length) providerCache = { at: Date.now(), list };
  return list;
}

/** glm-5.3 sometimes wraps its JSON in a fence or prefixes a sentence. Rejecting
 *  the whole reply throws away a correct answer, so take the first JSON object in
 *  it, and still fail if there is not one. Mirrors src/ask/enclave.mjs. */
function parseAnswer(content) {
  const attempts = [
    content,
    content.replace(/^[\s\S]*?```(?:json)?/i, "").replace(/```[\s\S]*$/, ""),
    (content.match(/\{[\s\S]*\}/) ?? [])[0],
  ];
  for (const a of attempts) {
    if (!a) continue;
    try {
      const o = JSON.parse(a.trim());
      if (o && typeof o === "object" && "answer" in o) return o;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/**
 * Call the enclave from this browser, with the owner's own key.
 *
 * This is the whole local-first claim: no server is in this path. It only
 * works because the page is served from localhost:5173, the one origin 0G's
 * CORS allowlist accepts.
 *
 * It now holds to what the server's copy holds to. It used to write
 * verification: "provider-address" on every receipt without checking any
 * provider, which is the claim the whole receipt rests on. An answer from a
 * machine that is not a TeeML enclave is discarded here, and `band`, the only
 * free text that reaches the asker, cannot carry a figure.
 */
export async function askEnclaveDirect(prepared, apiKey, { signal } = {}) {
  const t0 = Date.now();
  const body = prepared.body ?? prepared.request.body;

  // Before anything is sent. Checking only afterwards meant the lines had already gone
  // out by the time we found there was no sealed machine to have read them.
  const sealed = (await enclaveProviders(body.model ?? "glm-5.3", apiKey)).filter((p) => p.verifiability === "TeeML");
  if (!sealed.length) {
    const none = new Error("no sealed machine is listed right now, so nothing was sent");
    none.busy = true;
    none.retryAfterMs = 15_000;
    throw none;
  }

  let res = null;
  let failure = null;
  // 429 here is 0G saying the model is briefly overloaded, not that we asked too
  // much, and 503 means no free enclave. Both are worth waiting out, and neither is
  // ever a reason to relax the trust mode.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    failure = null;
    try {
      res = await fetch(prepared.url ?? prepared.request.url, {
        method: "POST",
        headers: { ...(prepared.headers ?? prepared.request.headers), Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(90_000),
      });
    } catch (e) {
      res = null;
      failure = e;
    }
    if (res && res.status !== 503 && res.status !== 429) break;
    if (attempt < 1) await sleep(2000);
  }
  if (failure) {
    throw new Error(
      failure?.name === "TimeoutError"
        ? "the enclave did not answer within 90 seconds, try again"
        : "could not reach the enclave from this browser",
    );
  }
  if (res.status === 401 || res.status === 403) {
    const refused = new Error("your 0G key was turned down, so nothing was answered");
    refused.keyRejected = true;
    throw refused;
  }
  if (res.status === 429 || res.status === 503) {
    const busy = new Error(
      "every sealed machine is busy. We waited rather than sending your document somewhere " +
        "less private, try once more in a moment",
    );
    // Nothing was read and nothing was spent, so this is a wait and not a failure.
    busy.busy = true;
    busy.retryAfterMs = Math.min(30, Number(res.headers.get("retry-after")) || 10) * 1000;
    throw busy;
  }
  if (!res.ok) throw new Error(`the sealed machine could not answer right now (${res.status})`);

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    // glm-5.3 reasons before emitting JSON and returns "" when it runs out of
    // budget. Parsing that into an answer would score a document never read.
    throw new Error("the enclave returned an empty reply, which is a failure and never an answer");
  }
  const parsed = parseAnswer(content);
  if (!parsed) throw new Error("the enclave's reply could not be read as an answer");

  const answer = String(parsed.answer ?? "").toLowerCase();
  if (!["yes", "no", "unknown"].includes(answer)) throw new Error(`the enclave answered "${answer}"`);

  const trace = json.x_0g_trace ?? {};
  const model = json.model ?? "glm-5.3";
  const machine = sealed.find((p) => String(p.address).toLowerCase() === String(trace.provider).toLowerCase());
  if (!machine) throw new Error("that answer came from a machine with no enclave, so it was thrown away");

  // Only words from a fixed list reach the asker. A digit check let "fifty thousand",
  // a name, or "५०००" straight through.
  const band = cleanBand(parsed.band);
  const why = String(parsed.why ?? "").trim().toLowerCase();

  return {
    answer,
    band,
    why: WHYS.includes(why) ? why : "",
    confidence: Number(parsed.confidence ?? NaN),
    outOfScope: parsed.in_scope === false,
    answerHash: await sha256hex(JSON.stringify({ answer, band })),
    enclaveRequestId: trace.request_id ?? json.id ?? "",
    provider: trace.provider,
    model,
    verification: "provider-address",
    teeType: machine.teeType ? `${machine.teeType}/${machine.teeVerifier}` : "",
    latencyMs: Date.now() - t0,
  };
}

/* ---------------------------------------------------- checking the server -- */

const NO_KEY = "0x0000000000000000000000000000000000000000";
const holds = (p) => p.then((v) => v === true, () => false);

/**
 * Did this owner really sign these terms?
 *
 * The owner's browser answers by itself, so it must not take the server's word for
 * what a permission allows. A server that could invent a permission, or widen its
 * topic, could have this browser answer anything about the document.
 */
export function signedByOwner(grant, owner) {
  if (!/^0x[0-9a-f]+$/i.test(String(grant?.ownerSig ?? ""))) return Promise.resolve(false);
  let message;
  try {
    message = {
      vaultId: String(grant.vaultId),
      verifier: getAddress(grant.verifier),
      questionSet: String(grant.questionSet),
      question: String(grant.note),
      usesAllowed: BigInt(grant.usesAllowed),
      diesAt: BigInt(grant.diesAt),
      sessionKey: getAddress(grant.sessionKey || NO_KEY),
      statement: STATEMENTS.grant,
    };
  } catch {
    return Promise.resolve(false);
  }
  return holds(
    verifyTypedData({ address: owner, domain: DOMAIN, types: { Grant: TYPES.Grant }, primaryType: "Grant", message, signature: grant.ownerSig }),
  );
}

/**
 * Did the person this permission names really ask exactly this, when it says? Signed by
 * their wallet, or by a key their wallet let sign under exactly this permission.
 */
export async function signedByAsker(request, grant) {
  if (!/^0x[0-9a-f]+$/i.test(String(request?.askerSig ?? ""))) return false;
  if ((await sha256hex(String(request.question))) !== request.questionHash) return false;
  const message = {
    grantId: String(request.grantId),
    questionHash: String(request.questionHash),
    askedAt: BigInt(request.askedAt),
    statement: STATEMENTS.request,
  };
  const by = (address, signature) =>
    holds(verifyTypedData({ address, domain: DOMAIN, types: { Request: TYPES.Request }, primaryType: "Request", message, signature }));
  if (!request.askerKey) return by(getAddress(grant.verifier), request.askerSig);
  let key;
  try {
    key = getAddress(request.askerKey);
  } catch {
    return false;
  }
  if (!(await by(key, request.askerSig))) return false;
  return holds(
    verifyTypedData({
      address: getAddress(grant.verifier),
      domain: DOMAIN,
      types: { AskKey: TYPES.AskKey },
      primaryType: "AskKey",
      message: { grantId: String(grant.grantId), sessionKey: key, diesAt: BigInt(grant.diesAt), statement: STATEMENTS.askKey },
      signature: request.askKeySig,
    }),
  );
}

/**
 * Is this a key 0G knows? Its balance endpoint answers a key it does not recognise with
 * 401 and costs nothing. Anything else, a 403 included, means the key itself is real.
 * If 0G cannot be reached at all, this does not stand in the way.
 */
export async function checkZeroGKey(apiKey) {
  try {
    const res = await fetch(`${ZG_BASE}/account/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    return res.status !== 401;
  } catch {
    return true;
  }
}

/**
 * Nothing in the document matched, so nothing is sent anywhere.
 *
 * Handing a model nothing relevant invites it to answer from the question alone,
 * and handing it everything defeats the point. The honest reply is "unknown",
 * written by this device, and the receipt says so instead of naming an enclave.
 */
export async function noMatchAnswer() {
  const answer = "unknown";
  const band = "";
  return {
    answer,
    band,
    why: "",
    outOfScope: false,
    answerHash: await sha256hex(JSON.stringify({ answer, band })),
    enclaveRequestId: "",
    provider: "",
    model: "",
    verification: "no-lines-matched",
    teeType: "",
    latencyMs: 0,
  };
}

/* ------------------------------------------------------------- display -- */

export const short = (s, h = 6, t = 4) =>
  !s ? "—" : String(s).length <= h + t + 1 ? String(s) : `${String(s).slice(0, h)}…${String(s).slice(-t)}`;

/** Rabdi makes a block every ~2s, so blocks are the honest unit - but six
 *  figures of them is noise, so past a day the duration leads. */
export function remaining(diesAtMs) {
  const ms = diesAtMs - Date.now();
  if (ms <= 0) return { dead: true, text: "expired", blocks: 0, showBlocks: false, ms: 0 };
  const blocks = Math.round(ms / 2000);
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  const text =
    hrs >= 24 ? `${Math.floor(hrs / 24)}d ${hrs % 24}h`
    : hrs >= 1 ? `${hrs}h ${mins % 60}m`
    : mins >= 1 ? `${mins}m ${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}s`
    : `${Math.floor(ms / 1000)}s`;
  return { dead: false, text, blocks, showBlocks: blocks < 100_000, ms };
}

export const timeAgo = (ms) => {
  const d = Date.now() - ms;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};
