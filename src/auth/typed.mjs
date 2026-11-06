/**
 * AskOnly — EIP-712 typed data, and the verification that makes the server
 * a paymaster rather than a trusted party.
 *
 * ── Why this file is the important one ───────────────────────────────────────
 *
 * Browser wallets are on Sepolia; Arkiv is its own chain with its own gas
 * token. Nobody is going to fund a second chain to try a demo, so the server
 * pays for every write.
 *
 * That is only acceptable because the server cannot AUTHOR anything. Every
 * record carries an EIP-712 signature from the party it claims to come from,
 * and the server verifies that signature recovers to the claimed address
 * before it writes. A server that wanted to forge a grant would have to forge
 * a signature.
 *
 * So the honest sentence is: the operator pays for the transaction and cannot
 * author one.
 */

import { verifyTypedData, recoverTypedDataAddress, getAddress, hashTypedData } from "viem";

/**
 * Deliberately chain-agnostic: name and version only.
 *
 * Every EIP-712 domain field is optional. Pinning chainId forced the signer's
 * wallet to be on that exact chain, and a mismatch makes MetaMask fail with an
 * opaque "An internal error was received" - which is what happens when someone
 * has their wallet on, say, 0G Mainnet.
 *
 * These signatures authorise a record; they are not transactions. Each message
 * already carries a unique grantId or requestId, so there is no cross-chain
 * replay to defend against. Dropping chainId means ANY wallet on ANY network
 * can sign, with no network-switching prompt in the way.
 */
export const domain = {
  name: "AskOnly",
  version: "1",
};

/**
 * Domains we will accept a signature under.
 *
 * The browser caches JavaScript. If the page is holding an older bundle than
 * the server is running, the two sign and verify under different domains and
 * every signature is rejected with "this was not signed by you" - which is a
 * true statement about the wrong question, and sends you hunting for a key
 * problem that does not exist.
 *
 * So we try each known domain. This gives up nothing: the signature must still
 * be produced by the claimed address over the exact message. It only stops a
 * deploy skew from looking like a forgery.
 */
export const ACCEPTED_DOMAINS = [
  domain,
  // pre-2026-11-06: the domain was pinned to Sepolia, which forced the signer's
  // wallet onto that chain and broke for anyone sitting on another network.
  { name: "AskOnly", version: "1", chainId: 11155111 },
];

/**
 * The id of the record a signature creates, taken from what was signed.
 *
 * Ids used to be random, so one signature could be posted again and again, each time
 * making a fresh permission or a fresh question. Now a signed message makes one record,
 * whatever bytes the signature arrives in.
 */
export const recordId = (prefix, types, primaryType, message) =>
  `${prefix}-${hashTypedData({ domain, types, primaryType, message }).slice(2, 14)}`;

/**
 * A grant. Signed by the data principal. This is the capability itself:
 * who may ask, what they may ask, how often, and until when.
 */
export const GrantTypes = {
  Grant: [
    { name: "vaultId", type: "string" },
    { name: "verifier", type: "address" },
    { name: "questionSet", type: "string" },
    { name: "question", type: "string" },
    { name: "usesAllowed", type: "uint256" },
    { name: "diesAt", type: "uint256" },
    // The key in the owner's browser that may answer under this permission. One
    // signature grants the right and starts the answering, for exactly that long.
    { name: "sessionKey", type: "address" },
    { name: "statement", type: "string" },
  ],
};

/**
 * A request to ask. Signed by the verifier, BEFORE they are told anything.
 * This is what lands in the owner's inbox.
 */
export const RequestTypes = {
  Request: [
    { name: "grantId", type: "string" },
    { name: "questionHash", type: "string" },
    { name: "askedAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
};

/**
 * An ASK KEY: the reviewer letting a key in their own browser sign questions under
 * one permission, so that asking is not a wallet popup every time. The owner's side
 * has had this since the start; the asker clicked "sign" for every question.
 *
 * Narrow on purpose: one grantId, and the grant's own diesAt, which must match it
 * exactly, so it cannot be carried to another permission or outlive this one. The
 * question is still the reviewer's: the request stores this signature next to the
 * key's, so anyone can trace it back to their wallet.
 */
export const AskKeyTypes = {
  AskKey: [
    { name: "grantId", type: "string" },
    { name: "sessionKey", type: "address" },
    { name: "diesAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
};

/**
 * An answer. Signed by the data principal's device, after it decrypted the
 * document locally and asked the enclave. Binds the question to the answer
 * and to the enclave run that produced it.
 */
export const AnswerTypes = {
  Answer: [
    { name: "requestId", type: "string" },
    { name: "grantId", type: "string" },
    { name: "questionHash", type: "string" },
    { name: "answerHash", type: "string" },
    { name: "enclaveRequestId", type: "string" },
    { name: "statement", type: "string" },
  ],
};

/**
 * A DELEGATION: the owner authorising one ephemeral key, held only in their
 * own tab's memory, to sign answers on their behalf.
 *
 * Why this exists. Every answer needs the owner's signature, so "answer
 * automatically" would still have meant a wallet popup per question, and the
 * person asking would still be waiting on a human to click. That is a UX
 * failure, not a cryptographic requirement.
 *
 * What it does NOT weaken: the passphrase never leaves the device either way,
 * the enclave still only sees the lines that were chosen, and the delegation
 * is scoped to ONE vault and expires - it cannot be used to answer about
 * another document, and it dies on its own.
 *
 * The key is generated in the browser and kept in its IndexedDB until the delegation
 * ends. web/src/lib/keystore.js says what that does and does not protect against.
 */
export const DelegationTypes = {
  Delegation: [
    { name: "vaultId", type: "string" },
    { name: "sessionKey", type: "address" },
    { name: "diesAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
};

/**
 * DELETING a sealed document, and ENDING a permission.
 *
 * Both used to be a route that took an entityKey from whoever POSTed it, or did
 * not exist. Anybody could end anybody's permission. The owner signs the id, and
 * the server checks that signature against the owner recorded on the entity
 * before it spends any gas on the write.
 */
export const ForgetTypes = {
  Forget: [
    { name: "vaultId", type: "string" },
    { name: "statement", type: "string" },
  ],
};

export const RevokeTypes = {
  Revoke: [
    { name: "grantId", type: "string" },
    { name: "statement", type: "string" },
  ],
};

/**
 * "This browser is answering right now", from the key a permission names. Lets the
 * person asking be told whether to expect a reply in seconds. Only a hint, and it
 * writes nothing, but only the owner's browser can claim it.
 */
export const PresenceTypes = {
  Presence: [
    { name: "grantId", type: "string" },
    { name: "at", type: "uint256" },
  ],
};

/** The human-readable line each signer sees in their wallet. */
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

const NO_KEY = "0x0000000000000000000000000000000000000000";

export function grantMessage({ vaultId, verifier, questionSet, question, usesAllowed, diesAt, sessionKey }) {
  return {
    vaultId: String(vaultId),
    verifier: getAddress(verifier),
    questionSet: String(questionSet),
    question: String(question),
    usesAllowed: BigInt(usesAllowed),
    diesAt: BigInt(diesAt),
    sessionKey: getAddress(sessionKey || NO_KEY),
    statement: STATEMENTS.grant,
  };
}

export function presenceMessage({ grantId, at }) {
  return { grantId: String(grantId), at: BigInt(at) };
}

export function requestMessage({ grantId, questionHash, askedAt }) {
  return {
    grantId: String(grantId),
    questionHash: String(questionHash),
    askedAt: BigInt(askedAt),
    statement: STATEMENTS.request,
  };
}

export function askKeyMessage({ grantId, sessionKey, diesAt }) {
  return {
    grantId: String(grantId),
    sessionKey: getAddress(sessionKey),
    diesAt: BigInt(diesAt),
    statement: STATEMENTS.askKey,
  };
}

export function delegationMessage({ vaultId, sessionKey, diesAt }) {
  return {
    vaultId: String(vaultId),
    sessionKey: getAddress(sessionKey),
    diesAt: BigInt(diesAt),
    statement: STATEMENTS.delegation,
  };
}

export function forgetMessage({ vaultId }) {
  return {
    vaultId: String(vaultId),
    statement: STATEMENTS.forget,
  };
}

export function revokeMessage({ grantId }) {
  return {
    grantId: String(grantId),
    statement: STATEMENTS.revoke,
  };
}

export function answerMessage({ requestId, grantId, questionHash, answerHash, enclaveRequestId }) {
  return {
    requestId: String(requestId),
    grantId: String(grantId),
    questionHash: String(questionHash),
    // A decline carries no answer, so these are empty strings. String(undefined)
    // is the literal "undefined", which differs from what the client signed and
    // made every decline fail as a bad signature.
    answerHash: String(answerHash ?? ""),
    enclaveRequestId: String(enclaveRequestId ?? ""),
    statement: STATEMENTS.answer,
  };
}

export class SignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = "SignatureError";
  }
}

/**
 * The gate. Nothing is written to Arkiv on a user's behalf without passing it.
 *
 * Deliberately gives a specific reason on failure: "this signature is from
 * 0xabc… but you claimed 0xdef…" is actionable, "invalid signature" is not.
 */
export async function requireSignature({ address, types, primaryType, message, signature }) {
  if (!address) throw new SignatureError("no address claimed");
  if (!signature) throw new SignatureError("no signature supplied");

  let claimed;
  try {
    claimed = getAddress(address);
  } catch {
    throw new SignatureError(`"${address}" is not an address`);
  }

  let lastError = null;
  for (const candidate of ACCEPTED_DOMAINS) {
    try {
      const valid = await verifyTypedData({
        address: claimed,
        domain: candidate,
        types,
        primaryType,
        message,
        signature,
      });
      if (valid) return claimed;
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError) {
    throw new SignatureError(
      `signature could not be checked: ${String(lastError.message).slice(0, 120)}`,
    );
  }

  // Recover whoever DID sign it. "signed by 0xAAA, you claimed 0xBBB" says
  // immediately whether this is the wrong account or a mangled message;
  // "not signed by you" sends people looking for a key problem instead.
  let signer = null;
  try {
    signer = await recoverTypedDataAddress({ domain, types, primaryType, message, signature });
  } catch {
    /* an unrecoverable signature tells us the message itself differs */
  }

  throw new SignatureError(
    signer
      ? `that signature is from ${signer}, but the request claims ${claimed}. ` +
        `Switch to the right account, or reload the page if it has been open a while.`
      : `this ${primaryType} could not be matched to ${claimed} — the signed message and the ` +
        `submitted one differ. Reload the page: it is usually a stale tab after a deploy.`,
  );
}

/** Everything a browser needs to produce a matching signature. */
export const clientSpec = {
  domain,
  types: {
    Grant: GrantTypes.Grant,
    Request: RequestTypes.Request,
    Answer: AnswerTypes.Answer,
    Delegation: DelegationTypes.Delegation,
    Forget: ForgetTypes.Forget,
    Revoke: RevokeTypes.Revoke,
    Presence: PresenceTypes.Presence,
    AskKey: AskKeyTypes.AskKey,
  },
  statements: STATEMENTS,
};
