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

import { verifyTypedData, getAddress } from "viem";

/** Sepolia, because that is the chain the users' wallets are actually on. */
export const CHAIN_ID = 11155111;

export const domain = {
  name: "AskOnly",
  version: "1",
  chainId: CHAIN_ID,
};

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

/** The human-readable line each signer sees in their wallet. */
export const STATEMENTS = {
  grant: "I allow this one question to be asked about my document, until it expires.",
  request: "I am asking this question, and I accept that it is recorded against me.",
  answer: "My device answered this question. The document was not sent.",
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

export function answerMessage({ requestId, grantId, questionHash, answerHash, enclaveRequestId }) {
  return {
    requestId: String(requestId),
    grantId: String(grantId),
    questionHash: String(questionHash),
    answerHash: String(answerHash),
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

  let valid = false;
  try {
    valid = await verifyTypedData({
      address: claimed,
      domain,
      types,
      primaryType,
      message,
      signature,
    });
  } catch (e) {
    throw new SignatureError(`signature could not be checked: ${String(e.message).slice(0, 120)}`);
  }

  if (!valid) {
    throw new SignatureError(
      `this ${primaryType} was not signed by ${claimed}. ` +
        `The server pays for the write but cannot author one, so it is refused.`,
    );
  }
  return claimed;
}

/** Everything a browser needs to produce a matching signature. */
export const clientSpec = {
  domain,
  types: { Grant: GrantTypes.Grant, Request: RequestTypes.Request, Answer: AnswerTypes.Answer },
  statements: STATEMENTS,
};
