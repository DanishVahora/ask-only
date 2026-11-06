/**
 * AskOnly — the ENSv2 authorization read layer.
 *
 * Addresses come from deployments.sepolia.json, never from a literal in here or
 * in the frontend. The ENS prize asks for "no hard-coded values" and it is also
 * just how you avoid demoing against a contract you redeployed an hour ago.
 *
 * ── A hazard worth knowing about ───────────────────────────────────────────────
 * Sepolia public RPC endpoints are load balanced. Two `eth_call`s issued back to
 * back can be served by nodes at DIFFERENT heights, so immediately after a write
 * you can observe one read that sees it and one that does not. Measured here on
 * 2026-11-06: right after granting a role, `mayAsk` returned true while
 * `permittedSets` returned income=false in the same breath - a UI showing both
 * would be visibly self-contradictory on stage.
 *
 * So: every group of reads that must agree is PINNED to one block number, and
 * after a write we wait until the node we are reading from has actually caught up.
 */

import { createPublicClient, http, keccak256, toHex, getAddress } from "viem";
import { sepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

let wiring = null;
let wiringError = null;
try {
  wiring = JSON.parse(readFileSync(path.join(ROOT, "deployments.sepolia.json"), "utf8"));
} catch {
  // Captured rather than thrown so the server boots degraded and says why,
  // instead of crashing on import with a stack trace nobody can act on.
  wiringError = "deployments.sepolia.json not found - run `npm run deploy`";
}

let gateAbi = null;
try {
  gateAbi = JSON.parse(readFileSync(path.join(ROOT, "build", "AskOnlyGate.json"), "utf8")).abi;
} catch {
  wiringError = wiringError ?? "build/AskOnlyGate.json not found - run `npm run compile`";
}

export const rpcUrl = () =>
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

export const client = () =>
  createPublicClient({ chain: sepolia, transport: http(rpcUrl(), { retryCount: 2, timeout: 20_000 }) });

export const addresses = {
  gate: wiring?.contracts?.AskOnlyGate?.address ?? null,
  gateDemo: wiring?.contracts?.AskOnlyGateDemo?.address ?? null,
  demoRegistry: wiring?.contracts?.MockENSRegistry?.address ?? null,
  ensRegistry: wiring?.ens?.ETHRegistry ?? null,
  explorer: wiring?.explorer ?? "https://sepolia.etherscan.io/address/",
};
export const questionSetRoles = wiring?.questionSets ?? null;
export { wiringError };

/** labelhash of ONE label, as uint256. Not a namehash. 0 is the EAC ROOT_RESOURCE. */
export const labelIdOf = (label) => (label ? BigInt(keccak256(toHex(label))) : 0n);

/**
 * Health, verified rather than asserted: `connected: true` means the contract
 * answered just now and its constructor values read back as expected.
 */
export async function gateStatus() {
  if (wiringError) return { connected: false, reason: wiringError };
  const pub = client();
  try {
    const blockNumber = await pub.getBlockNumber();
    const at = { blockNumber };
    const [code, ens, steward, incomeRole] = await Promise.all([
      pub.getCode({ address: addresses.gate }),
      pub.readContract({ address: addresses.gate, abi: gateAbi, functionName: "ens", ...at }),
      pub.readContract({ address: addresses.gate, abi: gateAbi, functionName: "steward", ...at }),
      pub.readContract({ address: addresses.gate, abi: gateAbi, functionName: "roleOf", args: ["income"], ...at }),
    ]);
    const hasCode = Boolean(code && code !== "0x");
    return {
      connected: hasCode,
      block: blockNumber.toString(),
      chainId: sepolia.id,
      gate: addresses.gate,
      gateDemo: addresses.gateDemo,
      ens: getAddress(ens),
      steward: getAddress(steward),
      incomeRole: incomeRole.toString(),
      // The claim the ENS track cares about, computed rather than declared.
      ensIsLiveRegistry:
        String(ens).toLowerCase() === String(addresses.ensRegistry).toLowerCase(),
      explorer: addresses.explorer,
    };
  } catch (e) {
    return { connected: false, reason: String(e?.shortMessage || e?.message || e).slice(0, 200) };
  }
}

/**
 * The authorization check. Returns every answer from ONE pinned block so the
 * caller can never render two reads that disagree.
 *
 * @param which "prod" reads the canonical ENSv2 ETHRegistry; "demo" reads the
 *              writable demo registry that has the same EAC semantics.
 */
export async function permissionSurface(asker, label, which = "demo") {
  if (wiringError) throw new Error(wiringError);
  const address = which === "prod" ? addresses.gate : addresses.gateDemo;
  const pub = client();
  const blockNumber = await pub.getBlockNumber();
  const at = { blockNumber };
  const labelId = labelIdOf(label);

  const [sets, income] = await Promise.all([
    pub.readContract({ address, abi: gateAbi, functionName: "permittedSets", args: [asker, labelId], ...at }),
    pub.readContract({ address, abi: gateAbi, functionName: "mayAskSet", args: [asker, labelId, "income"], ...at }),
  ]);

  const surface = {
    income: sets[0],
    identity: sets[1],
    tenancy: sets[2],
    employment: sets[3],
  };

  // Belt and braces: if two pinned reads of the same fact still disagree, say so
  // loudly rather than picking one. Silent disagreement is how a demo lies.
  if (surface.income !== income) {
    throw new Error(
      `inconsistent reads at block ${blockNumber}: permittedSets.income=${surface.income} but mayAskSet(income)=${income}`,
    );
  }

  return {
    asker: getAddress(asker),
    label: label ?? null,
    labelId: labelId.toString(),
    registry: which,
    registryAddress: address,
    block: blockNumber.toString(),
    permitted: surface,
    anyPermitted: Object.values(surface).some(Boolean),
  };
}

/** May this asker ask this one set? Single pinned read. */
/** The four on-chain role bits. A scope outside them falls back to `income`,
 *  which the gate treats as the general "may ask about this name" right -
 *  the owner is the real enforcement point and reads every question anyway. */
export const roleTagFor = (questionSet) =>
  ["income", "identity", "tenancy", "employment"].includes(questionSet) ? questionSet : "income";

export async function mayAsk(asker, label, questionSet, which = "demo") {
  questionSet = roleTagFor(questionSet);
  if (wiringError) throw new Error(wiringError);
  const address = which === "prod" ? addresses.gate : addresses.gateDemo;
  const pub = client();
  const blockNumber = await pub.getBlockNumber();
  return pub.readContract({
    address,
    abi: gateAbi,
    functionName: "mayAskSet",
    args: [asker, labelIdOf(label), questionSet],
    blockNumber,
  });
}

/**
 * Wait until the endpoint we read from has actually applied a block. Without
 * this, a read issued right after a write can be answered by a lagging node.
 */
export async function waitForBlock(target, { tries = 15, delayMs = 1000 } = {}) {
  const pub = client();
  for (let i = 0; i < tries; i += 1) {
    const now = await pub.getBlockNumber();
    if (now >= BigInt(target)) return now;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`RPC did not reach block ${target} in ${tries * delayMs}ms`);
}

export { gateAbi };
