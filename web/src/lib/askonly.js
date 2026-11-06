/**
 * AskOnly — the client side of the protocol.
 *
 * Three things live here and nowhere else:
 *   1. document encryption, which happens in this page and only this page
 *   2. the EIP-712 payloads, which must match the server byte for byte
 *   3. the direct call to the enclave, which never goes through our server
 */

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
    sha256: await sha256hex(plaintext),
    bytesLen: cipher.length,
  };
}

export async function decryptDocument(cipherHex, ivB64, passphrase) {
  const bytes = fromHex(cipherHex);
  const key = await deriveKey(passphrase, bytes.slice(0, 16));
  try {
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, bytes.slice(16)));
  } catch {
    // AES-GCM fails authentication rather than returning garbage, which is what
    // we want: a wrong passphrase is a refusal, not a corrupt read.
    throw new Error("wrong passphrase, or this ciphertext has been altered");
  }
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
};

/** The line each signer actually reads in their wallet. */

export const STATEMENTS = {
  grant: "I allow this one question to be asked about my document, until it expires.",
  request: "I am asking this question, and I accept that it is recorded against me.",
  answer: "My device answered this question. The document was not sent.",
  delegation:
    "I let this browser answer questions about this one document on my behalf, until it expires.",
};

/* -------------------------------------------------------------- enclave -- */

/**
 * Call the enclave from this browser, with the owner's own key.
 *
 * This is the whole local-first claim: no server is in this path. It only
 * works because the page is served from localhost:5173, the one origin 0G's
 * CORS allowlist accepts.
 */
export async function askEnclaveDirect(prepared, apiKey, { signal } = {}) {
  const t0 = Date.now();
  // glm-5.3 reasons for 15-20s on a hard question and the router is
  // intermittently slow. Without a timeout the tab just hangs on "asking the
  // enclave" with no way back.
  let res;
  try {
    res = await fetch(prepared.url ?? prepared.request.url, {
      method: "POST",
      headers: { ...(prepared.headers ?? prepared.request.headers), Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(prepared.body ?? prepared.request.body),
      signal: signal ?? AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new Error(
      e?.name === "TimeoutError"
        ? "the enclave did not answer within 90 seconds — try again"
        : "could not reach the enclave from this browser",
    );
  }
  if (res.status === 401 || res.status === 403) throw new Error("that 0G key was not accepted");
  if (res.status === 429) throw new Error("that was a lot at once — wait a few seconds and try again");
  if (res.status === 503)
    throw new Error(
      "every sealed machine is busy. We waited rather than sending your document somewhere " +
        "less private — try once more in a moment",
    );
  if (!res.ok) throw new Error(`the sealed machine could not answer right now (${res.status})`);

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    // glm-5.3 reasons before emitting JSON and returns "" when it runs out of
    // budget. Parsing that into an answer would score a document never read.
    throw new Error("the enclave returned an empty completion — treated as failure, never as an answer");
  }
  const parsed = JSON.parse(content);
  const trace = json.x_0g_trace ?? {};
  const answer = String(parsed.answer ?? "").toLowerCase();
  if (!["yes", "no", "unknown"].includes(answer)) throw new Error(`the enclave answered "${answer}"`);

  return {
    answer,
    band: String(parsed.band ?? ""),
    why: String(parsed.why ?? "").slice(0, 90),
    answerHash: await sha256hex(JSON.stringify({ answer, band: String(parsed.band ?? "") })),
    enclaveRequestId: trace.request_id ?? json.id ?? "",
    provider: trace.provider ?? "",
    model: json.model ?? "glm-5.3",
    verification: "provider-address",
    teeType: "TDX/dstack",
    latencyMs: Date.now() - t0,
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
