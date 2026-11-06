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

/** A write that was refused because what it depended on changed while it waited its
 *  turn: the question was answered, or the permission ended. Carries the status the
 *  route answers with. */
export class StateError extends ArkivError {
  constructor(message, status) {
    super(message);
    this.name = "StateError";
    this.status = status;
  }
}

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
    // Blocks are 2s. viem's default of polling every 4s for a receipt turned a 2s
    // write into anything up to 7s, and an answer is the moment someone is waiting.
    const reader = createPublicClient({ chain, transport, cacheTime: 0, pollingInterval: 500 });
    const wallet = acct
      ? createWalletClient({ account: acct, chain, transport, cacheTime: 0, pollingInterval: 500 })
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
/* One write at a time, for the whole process.
 *
 * Every write in this app comes from one wallet, and the check below refuses to
 * send while a transaction is still pending. That was fine with one person
 * clicking. With several questions open, a tab answering by itself and someone
 * else asking at the same moment, the second write failed outright with
 * "reconcile the pending nonce". So writes queue, and a pending nonce is waited
 * out rather than reported as an error. */
let writeQueue = Promise.resolve();
const NONCE_WAIT_MS = 20_000;

/* Balance and block limit move slowly and each is a 200ms round trip, so they are
 * checked once a minute rather than before every write. */
const FUNDS_EVERY_MS = 60_000;
let fundsCheckedAt = 0;
let gasCeiling = 0n;

/* Whether a failed send can go again without risking a second copy.
 *
 * No hash coming back does not on its own mean nothing was sent. A request that timed
 * out, or a connection that dropped, may still have reached the node, and sending again
 * would then write the same record twice. Only a node that answered with an error
 * definitely did not take it. */
function safeToResend(e) {
  if (e?.name !== "EntityMutationError" || e.txHash !== undefined) return false;
  let c = e;
  for (let depth = 0; c && depth < 8; depth += 1, c = c.cause) {
    // The error's own name and details, not its whole message: viem puts the RPC URL in
    // the message, and the RPC lives on arkiv.network.
    const said = [c.name, c.shortMessage, c.details, c.code].filter(Boolean).join(" ") || String(c.message ?? "");
    if (/timeout|timed out|took too long|fetch failed|socket hang up|econnreset|econnrefused/i.test(said)) {
      return false;
    }
  }
  return true;
}

export function guardedWrite(ctx, fn, opts) {
  const run = writeQueue.then(() => writeOne(ctx, fn, opts));
  writeQueue = run.catch(() => {});
  return run;
}

async function writeOne(
  { reader, wallet },
  fn,
  { operations = 1, label = "write" } = {},
) {
  if (!wallet) throw safeError("guardedWrite needs a wallet client");
  const address = wallet.account.address;

  try {
    const deadline = Date.now() + NONCE_WAIT_MS;
    for (;;) {
      const [latest, pending] = await Promise.all([
        reader.getTransactionCount({ address, blockTag: "latest" }),
        reader.getTransactionCount({ address, blockTag: "pending" }),
      ]);
      if (pending === latest) break;
      if (Date.now() > deadline) {
        throw safeError(`reconcile the pending nonce before writing (${label})`);
      }
      await new Promise((r) => setTimeout(r, 750));
    }

    if (Date.now() - fundsCheckedAt > FUNDS_EVERY_MS) {
      const [balance, block] = await Promise.all([
        reader.getBalance({ address }),
        reader.getBlock({ blockTag: "latest" }),
      ]);
      if (balance === 0n) {
        throw safeError(`${address} has 0 tGLM - fund it at ${FAUCET} before writing`);
      }
      gasCeiling = block.gasLimit / 2n;
      fundsCheckedAt = Date.now();
    }

    const floor = 1_000_000n + 400_000n * BigInt(Math.max(0, operations - 1));
    if (floor > gasCeiling) {
      throw safeError(`gas floor ${floor} exceeds half the block limit (${gasCeiling})`);
    }

    // A transaction the node refused can safely go again: another process using this
    // wallet took the nonce, or a node hiccuped. One that may have been sent cannot,
    // because it may yet land, and a second copy would be a duplicate record.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn({ gas: floor });
      } catch (e) {
        if (!safeToResend(e) || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
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
  seconds: (n) => ExpirationTime.fromSeconds(n), // a whole number of 2s blocks
  minutes: (n) => ExpirationTime.fromMinutes(n),
  hours: (n) => ExpirationTime.fromHours(n),
  days: (n) => ExpirationTime.fromDays(n),
};

export const txLink = (hash) => `${EXPLORER}/tx/${hash}`;
export const entityLink = (key) => `${EXPLORER}/entity/${key}`;
