/**
 * What lets this browser carry on after a reload, without asking again.
 *
 * Permission is decided once, when you add a reviewer, and asking for the passphrase
 * again because a tab reloaded would undo that. So the key derived from the passphrase
 * is kept here, in IndexedDB, as a NON-EXTRACTABLE CryptoKey: this browser can use it,
 * and no script can read its bytes out through the API.
 *
 * That is not protection from the disk. Chrome writes the key material into this
 * profile's IndexedDB files (tested: the bytes of a non-extractable key appeared in
 * the clear in the leveldb log), and the ciphertext is public, so anyone who can read
 * this profile's files while a record exists can open the document without the
 * passphrase. That is the price of answering after a reload without asking again, and
 * it is why a record ends with the permissions it serves, and carries `until`.
 *
 * The passphrase is never stored, and neither is the document, which comes back from
 * the network as ciphertext and is decrypted into memory. The session's signing key
 * is kept encrypted under that same key.
 *
 * A record goes when its permissions have all ended, when the document is deleted, or
 * when this browser's data is cleared. Anyone using this browser profile can answer
 * for as long as those permissions run. That is the deal: the owner's device is the
 * trust boundary, and it always was.
 */

const DB = "askonly";
const STORE = "sessions";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "vaultId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  });
}

export const putSession = (record) => tx("readwrite", (s) => s.put(record));
export const removeSession = (vaultId) => tx("readwrite", (s) => s.delete(vaultId));
export const allSessions = async () => (await tx("readonly", (s) => s.getAll())) ?? [];

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Encrypt a string under the document's key. */
export async function wrapSecret(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  return { iv, data };
}

export async function unwrapSecret(key, { iv, data }) {
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
}
