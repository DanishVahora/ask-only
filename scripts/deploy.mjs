/**
 * AskOnly — deploy to Sepolia.
 *
 *   npm run deploy
 *
 * Deploys three things, for two different and both honest purposes:
 *
 *   1. AskOnlyGate -> the REAL ENSv2 ETHRegistry.
 *      This is the production wiring. Every `mayAsk` is four live ENS calls into
 *      the canonical registry. It proves the integration is real, not simulated.
 *
 *   2. MockENSRegistry + AskOnlyGateDemo -> that mock.
 *      Granting a role on a name we do not control is not possible, so the
 *      refuse -> grant -> succeed beat runs against a registry we can write to.
 *      It replicates the real ALL_ROLES validation and root-OR semantics, so the
 *      behaviour shown is the behaviour ENS would give. This is labelled as a
 *      demo registry in the UI and in the README - never passed off as canonical.
 *
 * Writes deployments.sepolia.json. The frontend reads addresses from there and
 * hard-codes nothing, which the ENS prize asks for explicitly.
 */

import { createWalletClient, createPublicClient, http, formatEther, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const artifact = (n) => JSON.parse(readFileSync(path.join(ROOT, "build", `${n}.json`), "utf8"));

/** ENSv2 on Sepolia, from the ENS docs deployments page (commit 07e55a05). */
const ENS_SEPOLIA = {
  ETHRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  RootRegistry: "0xb458d6a3a77919449d03e7a6903c26827c1ec43f",
  UserRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
  VerifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  LabelStore: "0xed8246ff02203a4d4cb262bd78beaa7408a57cae",
  ETHRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
};

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);

const rpc = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wal = createWalletClient({ account, chain: sepolia, transport: http(rpc) });

console.log(`deployer ${account.address}`);
const balance = await pub.getBalance({ address: account.address });
console.log(`balance  ${formatEther(balance)} ETH`);
if (balance === 0n) {
  console.error("\nNo Sepolia ETH. Fund the deployer before deploying.");
  process.exit(1);
}

// Refuse to deploy against an address with no code - that silently produces a
// gate whose every call reverts, and the cause is not obvious at 3am.
const ensCode = await pub.getCode({ address: ENS_SEPOLIA.ETHRegistry });
if (!ensCode || ensCode === "0x") {
  console.error(`\nNo bytecode at ETHRegistry ${ENS_SEPOLIA.ETHRegistry}. Refusing to deploy.`);
  process.exit(1);
}
console.log(`ENSv2 ETHRegistry has ${(ensCode.length - 2) / 2} bytes of code\n`);

async function deploy(name, args, note) {
  const a = artifact(name);
  process.stdout.write(`deploying ${name} ... `);
  const hash = await wal.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${name} deployment reverted`);
  console.log(`${receipt.contractAddress}  (gas ${receipt.gasUsed})`);
  return {
    address: getAddress(receipt.contractAddress),
    gasUsed: receipt.gasUsed.toString(),
    txHash: hash,
    note,
  };
}

/* 1. the production gate, on the real registry */
const gate = await deploy(
  "AskOnlyGate",
  [ENS_SEPOLIA.ETHRegistry, account.address],
  "Production gate. Reads the canonical ENSv2 ETHRegistry on every mayAsk.",
);

/* 2. a registry we can actually grant roles on, for the live refusal beat */
const mock = await deploy(
  "MockENSRegistry",
  [],
  "Demo registry. Replicates ENSv2 ALL_ROLES validation and root-OR semantics so a role can be granted on stage. NOT the canonical registry.",
);
const gateDemo = await deploy(
  "AskOnlyGate",
  [mock.address, account.address],
  "Demo gate, pointed at the demo registry, so refuse -> grant -> succeed can be performed live.",
);

/* 3. verify rather than assert - read the constructor values back out */
console.log("\nverifying deployments by reading them back:");
const gateAbi = artifact("AskOnlyGate").abi;
const read = (address, fn, args = []) =>
  pub.readContract({ address, abi: gateAbi, functionName: fn, args });

const ensOnChain = await read(gate.address, "ens");
const stewardOnChain = await read(gate.address, "steward");
const incomeRole = await read(gate.address, "roleOf", ["income"]);
const live = String(ensOnChain).toLowerCase() === ENS_SEPOLIA.ETHRegistry.toLowerCase();
console.log(`  gate.ens      ${ensOnChain}  ${live ? "== canonical ENSv2 ETHRegistry" : "!! NOT the canonical registry"}`);
console.log(`  gate.steward  ${stewardOnChain}`);
console.log(`  roleOf(income) ${incomeRole}  (1<<40 = ${1n << 40n})`);
if (incomeRole !== 1n << 40n) throw new Error("income role bit is wrong on-chain");

// And a real call into the live ENS registry through our gate.
const probe = "0x0000000000000000000000000000000000000001";
const answered = await read(gate.address, "mayAskSet", [probe, 0n, "income"]);
console.log(`  mayAskSet(probe, ROOT, "income") -> ${answered}   (a live ENSv2 call answered)`);

const out = {
  chainId: sepolia.id,
  network: "sepolia",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  contracts: {
    AskOnlyGate: gate,
    MockENSRegistry: mock,
    AskOnlyGateDemo: gateDemo,
  },
  ens: ENS_SEPOLIA,
  ensIsLiveRegistry: live,
  questionSets: {
    income: (1n << 40n).toString(),
    identity: (1n << 44n).toString(),
    tenancy: (1n << 48n).toString(),
    employment: (1n << 52n).toString(),
  },
  explorer: "https://sepolia.etherscan.io/address/",
};
writeFileSync(path.join(ROOT, "deployments.sepolia.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nwrote deployments.sepolia.json`);
console.log(`  gate      ${out.explorer}${gate.address}`);
console.log(`  demo gate ${out.explorer}${gateDemo.address}`);
