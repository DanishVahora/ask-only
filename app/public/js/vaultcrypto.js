/**
 * AskOnly — browser-side document encryption.
 *
 * The document key is derived in this page, lives in this page, and is handed
 * to nothing. The server receives ciphertext and an IV; it has no way to read
 * either. That is why /api/vault can be a plain unauthenticated write: there is
 * nothing in the payload worth protecting beyond what the owner already chose
 * to publish.
 *
 * AES-GCM-256 with a key wrapped by a passphrase through PBKDF2. The passphrase
 * never leaves the page either - only the owner can reopen their own vault.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const toHex = (bytes) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex) => {
  const h = String(hex).replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
};

export const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sha256hex(text) {
  const d = await crypto.subtle.digest("SHA-256", typeof text === "string" ? enc.encode(text) : text);
  return toHex(d);
}

/** 210,000 PBKDF2 iterations - OWASP's 2023 floor for SHA-256, and a passphrase
 *  is the only thing standing between a stolen ciphertext and the document. */
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

/**
 * Encrypt a document. Returns everything the server needs and nothing it could
 * use: the salt and IV are public by design, the passphrase is not sent.
 */
export async function encryptDocument(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const body = enc.encode(plaintext);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, body));

  // salt is prefixed so the ciphertext is self-describing on the way back.
  const cipher = new Uint8Array(salt.length + sealed.length);
  cipher.set(salt, 0);
  cipher.set(sealed, salt.length);

  if (cipher.length > 128 * 1024) {
    throw new Error(
      `this document encrypts to ${(cipher.length / 1024).toFixed(1)} KiB; Arkiv allows 128 KiB per write`,
    );
  }

  return {
    cipher,
    cipherHex: `0x${toHex(cipher)}`,
    iv: b64(iv),
    sha256: await sha256hex(plaintext), // of the PLAINTEXT, so the owner can prove which document
    bytesLen: cipher.length,
  };
}

export async function decryptDocument(cipherBytes, ivB64, passphrase) {
  const bytes = cipherBytes instanceof Uint8Array ? cipherBytes : fromHex(cipherBytes);
  const salt = bytes.slice(0, 16);
  const sealed = bytes.slice(16);
  const key = await deriveKey(passphrase, salt);
  try {
    const open = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivB64) }, key, sealed);
    return dec.decode(open);
  } catch {
    // AES-GCM fails authentication rather than returning garbage, which is the
    // behaviour we want: a wrong passphrase is a refusal, not a corrupt read.
    throw new Error("wrong passphrase, or this ciphertext has been altered");
  }
}
