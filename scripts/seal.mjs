/**
 * AskOnly — a signed seal, for the scripts that put a document on Arkiv through the
 * server. Sealing is signed now (src/auth/typed.mjs, Seal), so a script seals the way
 * the browser does: random bytes standing in for a ciphertext, their hash, and the
 * owner's signature over that hash and the document's name.
 */

import { createHash } from "node:crypto";

import { SealTypes, sealMessage, domain } from "../src/auth/typed.mjs";

export async function sealedBody(account, { label, docKind = "document", bytes = 256, days = 30, cipher = null }) {
  const raw = cipher ?? crypto.getRandomValues(new Uint8Array(bytes));
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const ownerSig = await account.signTypedData({
    domain,
    types: SealTypes,
    primaryType: "Seal",
    message: sealMessage({ sha256, label }),
  });
  return {
    owner: account.address,
    label,
    docKind,
    sha256,
    ownerSig,
    iv: Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString("base64"),
    cipher: `0x${Buffer.from(raw).toString("hex")}`,
    days,
  };
}
