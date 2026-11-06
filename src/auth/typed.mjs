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

import { verifyTypedData, recoverTypedDataAddress, getAddress } from "viem";

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
 * The key is generated in the browser, never persisted, and gone on reload.
 */
export const DelegationTypes = {
  Delegation: [
    { name: "vaultId", type: "string" },
    { name: "sessionKey", type: "address" },
    { name: "diesAt", type: "uint256" },
    { name: "statement", type: "string" },
  ],
};

/** The human-readable line each signer sees in their wallet. */
export const STATEMENTS = {
  grant: "I allow this one question to be asked about my document, until it expires.",
  request: "I am asking this question, and I accept that it is recorded against me.",
  answer: "My device answered this question. The document was not sent.",
  delegation:
    "I let this browser answer questions about this one document on my behalf, until it expires.",
};

export function grantMessage({ vaultId, verifier, questionSet, question, usesAllowed, diesAt }) {
  return {
    vaultId: String(vaultId),
    verifier: getAddress(verifier),
    questionSet: String(questionSet),
    question: String(question),
    usesAllowed: BigInt(usesAllowed),
    diesAt: BigInt(diesAt),
    statement: STATEMENTS.grant,
  };
}

export function requestMessage({ grantId, questionHash, askedAt }) {
  return {
    grantId: String(grantId),
    questionHash: String(questionHash),
    askedAt: BigInt(askedAt),
    statement: STATEMENTS.request,
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
  },
  statements: STATEMENTS,
};
