/**
 * AskOnly — Arkiv (Rabdi) client and guarded write path.
 *
 * Two things in here are not optional:
 *
 * 1. SCRUBBING. `rabdi({ accessKey })` path-encodes the access key INTO the RPC
 *    URL, so any raw transport error stringifies the key into your logs, your
 *    terminal and your UI. Every error that leaves this module goes through scrub().
 *
 * 2. EXPLICIT GAS. Default estimation produced gas-exhaustion reverts on Rabdi.
 *    SDK 1.0.1 release notes say it now adds 25% over estimate automatically and
 *    that the manual floor is obsolete; the working build on this machine still
 *    passes an explicit floor and succeeds. Explicit gas wins over the automatic
 *    margin, unused gas is refunded, and a too-low value costs a failed write and
 *    a confusing revert - so we keep the floor. (Recorded in arkiv/friction.md.)
 *
 * createPublicClient / createWalletClient come from the ARKIV SDK, not from viem.
 */

import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const RABDI_CHAIN_ID = 7794095;
export const EXPLORER = "https://rabdi.explorer.arkiv.network";
export const FAUCET = "https://hub.arkiv.network/faucet";
export const ACCESS_KEYS = "https://hub.arkiv.network/access-keys";

/** Strip the access key and any RPC URL out of an error before it is seen by
 *  anyone. Also collapses viem's multi-line errors to one readable line. */
export const scrub = (e) =>
  String(e?.shortMessage || e?.message || e)
    .replace(/ark_live_[A-Za-z0-9_-]+/g, "ark_live_<redacted>")
    .replace(/https?:\/\/[^\s)]+/g, "<rpc-redacted>")
    .replace(/wss?:\/\/[^\s)]+/g, "<rpc-redacted>")
    .split("\n")[0]
    .slice(0, 240);

export class ArkivError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "ArkivError";
    if (cause) this.cause = cause;
  }
}
export const safeError = (msg) => new ArkivError(msg);
export const sanitizedFailure = (e) => new ArkivError(scrub(e), undefined);

export function account() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw safeError("DEPLOYER_PRIVATE_KEY is not set - see .env.example");
  const key = pk.startsWith("0x") ? pk : `0x${pk}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw safeError("DEPLOYER_PRIVATE_KEY is not a 32-byte hex key");
  }
  return privateKeyToAccount(key);
}

export function accessKey() {
  const k = process.env.ARKIV_ACCESS_KEY;
  if (!k) {
    throw safeError(
      `ARKIV_ACCESS_KEY is not set. Get one at ${ACCESS_KEYS} (one key per wallet per network).`,
    );
  }
  return k;
}

/**
 * Build the chain + clients. `http()` is called with NO url: `rabdi({accessKey})`
 * returns a chain whose rpcUrls already carry the key, and viem picks it up.
 */
export function clients(acct = undefined, key = undefined) {
  try {
    const chain = rabdi({ accessKey: key ?? accessKey() });
    const transport = http(undefined, {
      retryCount: 0,
      timeout: 20_000,
      fetchOptions: { cache: "no-store", redirect: "error" },
    });
    const reader = createPublicClient({ chain, transport, cacheTime: 0 });
    const wallet = acct
      ? createWalletClient({ account: acct, chain, transport, cacheTime: 0 })
      : null;
    return { chain, reader, wallet };
  } catch (e) {
    throw sanitizedFailure(e);
  }
}

/** Read-only clients. Reads cost no gas, so this works with a zero-balance wallet
 *  and is how every query shape gets validated before anything is funded. */
export function readOnly() {
  return clients(undefined).reader;
}

export async function preflight(reader, address) {
  try {
    const [chainId, block, balance] = await Promise.all([
      reader.getChainId(),
      reader.getBlockNumber(),
      address ? reader.getBalance({ address }) : Promise.resolve(null),
    ]);
    if (Number(chainId) !== RABDI_CHAIN_ID) {
      throw safeError(`wrong chain: got ${chainId}, expected ${RABDI_CHAIN_ID} (Rabdi)`);
    }
    return {
      chainId: Number(chainId),
      block: block.toString(),
      balanceWei: balance === null ? null : balance.toString(),
      balance: balance === null ? null : formatEther(balance),
      funded: balance === null ? null : balance > 0n,
      faucet: FAUCET,
    };
  } catch (e) {
    throw sanitizedFailure(e);
  }
}

/**
 * The guarded write.
 *
 * - Refuses to start if a pending nonce is unreconciled, which otherwise produces
 *   a replacement-underpriced error halfway through a demo.
 * - Floors gas rather than trusting estimation on a six-day-old chain.
 * - Caps at half the block gas limit so a bad floor fails fast and locally
 *   instead of being mined into a revert.
 */
export async function guardedWrite(
  { reader, wallet },
  fn,
  { operations = 1, label = "write" } = {},
) {
  if (!wallet) throw safeError("guardedWrite needs a wallet client");
  const address = wallet.account.address;

  try {
    const [latest, pending] = await Promise.all([
      reader.getTransactionCount({ address, blockTag: "latest" }),
      reader.getTransactionCount({ address, blockTag: "pending" }),
    ]);
    if (pending !== latest) {
      throw safeError(`reconcile the pending nonce before writing (${label})`);
    }

    const balance = await reader.getBalance({ address });
    if (balance === 0n) {
      throw safeError(`${address} has 0 tGLM - fund it at ${FAUCET} before writing`);
    }

    const floor = 1_000_000n + 400_000n * BigInt(Math.max(0, operations - 1));
    const block = await reader.getBlock({ blockTag: "latest" });
    const ceiling = block.gasLimit / 2n;
    if (floor > ceiling) {
      throw safeError(`gas floor ${floor} exceeds half the block limit (${ceiling})`);
    }

    return await fn({ gas: floor });
  } catch (e) {
    if (e instanceof ArkivError) throw e;
    throw sanitizedFailure(e);
  }
}

/** Expiry helpers. `expiration` is REQUIRED on create in 1.0.x.
 *  `permanent()` and `fromYears()` no longer exist - fromYears throws
 *  InvalidExpiryError, and nothing can outlive MAX_LIFETIME (~182.5 days)
 *  without a deliberate, publicly observable renewal. That ceiling is the
 *  point, not a limitation: silence means death, so retention takes a signed act. */
export const expiry = {
  minutes: (n) => ExpirationTime.fromMinutes(n),
  hours: (n) => ExpirationTime.fromHours(n),
  days: (n) => ExpirationTime.fromDays(n),
};

export const txLink = (hash) => `${EXPLORER}/tx/${hash}`;
export const entityLink = (key) => `${EXPLORER}/entity/${key}`;
