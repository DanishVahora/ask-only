/**
 * AskOnly — AskOnlyGate tests.
 *
 *   npm run chain             (in another terminal - port 8546)
 *   npm test
 *
 * These run against a local chain so they are fast and free, but the mock they
 * run against replicates the live registry's ALL_ROLES validation and root-OR
 * semantics - so a test cannot pass on a bitmap Sepolia would reject.
 */

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createWalletClient, createPublicClient, http, keccak256, toHex, parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

const ROOT = path.resolve(import.meta.dirname, "..");
const artifact = (n) => JSON.parse(readFileSync(path.join(ROOT, "build", `${n}.json`), "utf8"));

// Hardhat's deterministic account #0 and #1.
const DEPLOYER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const LANDLORD = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const RPC = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8546";
const transport = http(RPC);
const pub = createPublicClient({ chain: hardhat, transport });
const wal = createWalletClient({ account: DEPLOYER, chain: hardhat, transport });

const ROLE_ASK_INCOME = 1n << 40n;
const ROLE_ASK_IDENTITY = 1n << 44n;
const ILLEGAL = 0xfn << 40n; // a "level 15" nybble - the real registry rejects this
const INCOME = keccak256(toHex("income"));
const IDENTITY = keccak256(toHex("identity"));
const LABEL = BigInt(keccak256(toHex("danish"))); // labelhash of ONE label, as uint256
const ROOT_RESOURCE = 0n;

let gate, mock, gateAbi, mockAbi;

async function deploy(name, args) {
  const a = artifact(name);
  const hash = await wal.deployContract({ abi: a.abi, bytecode: a.bytecode, args });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { address: receipt.contractAddress, abi: a.abi };
}

before(async () => {
  const m = await deploy("MockENSRegistry", []);
  mock = m.address;
  mockAbi = m.abi;
  const g = await deploy("AskOnlyGate", [mock, DEPLOYER.address]);
  gate = g.address;
  gateAbi = g.abi;
});

const read = (fn, args = []) => pub.readContract({ address: gate, abi: gateAbi, functionName: fn, args });
const grant = async (anyId, bits, who) => {
  const hash = await wal.writeContract({ address: mock, abi: mockAbi, functionName: "grantRoles", args: [anyId, bits, who] });
  await pub.waitForTransactionReceipt({ hash });
};
const revoke = async (anyId, bits, who) => {
  const hash = await wal.writeContract({ address: mock, abi: mockAbi, functionName: "revokeRoles", args: [anyId, bits, who] });
  await pub.waitForTransactionReceipt({ hash });
};

describe("wiring", () => {
  test("points at the registry it was given, immutably", async () => {
    assert.equal((await read("ens")).toLowerCase(), mock.toLowerCase());
    assert.equal((await read("steward")).toLowerCase(), DEPLOYER.address.toLowerCase());
  });

  test("maps the four question sets to four distinct free nybbles", async () => {
    assert.equal(await read("roleOf", ["income"]), ROLE_ASK_INCOME);
    assert.equal(await read("roleOf", ["identity"]), ROLE_ASK_IDENTITY);
    assert.equal(await read("roleOf", ["tenancy"]), 1n << 48n);
    assert.equal(await read("roleOf", ["employment"]), 1n << 52n);
  });

  test("labelIdOf is the labelhash of a single label as uint256, not a namehash", async () => {
    assert.equal(await read("labelIdOf", ["danish"]), LABEL);
  });
});

describe("role bitmap legality - a nybble is a boolean, not a 0-15 level", () => {
  test("accepts a single low bit", async () => {
    assert.equal(await read("isLegalRoleBitmap", [ROLE_ASK_INCOME]), true);
  });

  test("rejects 0xF<<40, which the live registry reverts as EACInvalidRoleBitmap", async () => {
    assert.equal(await read("isLegalRoleBitmap", [ILLEGAL]), false);
  });

  test("the MOCK also rejects it - so no test can pass on a bitmap Sepolia refuses", async () => {
    await assert.rejects(
      () => pub.readContract({ address: mock, abi: mockAbi, functionName: "hasRoles", args: [LABEL, ILLEGAL, LANDLORD.address] }),
      /EACInvalidRoleBitmap|reverted/i,
    );
  });
});

describe("the refuse -> grant -> succeed loop (this is the ENS beat)", () => {
  test("refuses before any role is granted", async () => {
    assert.equal(await read("mayAsk", [LANDLORD.address, LABEL, INCOME]), false);
  });

  test("requireMayAsk reverts, and names who was refused and why", async () => {
    await assert.rejects(
      () => read("requireMayAsk", [LANDLORD.address, LABEL, INCOME]),
      (e) => /NotPermitted|reverted/i.test(String(e)),
    );
  });

  test("granting the income role on-chain makes the same question answerable", async () => {
    await grant(LABEL, ROLE_ASK_INCOME, LANDLORD.address);
    assert.equal(await read("mayAsk", [LANDLORD.address, LABEL, INCOME]), true);
  });

  test("but ONLY that question set - identity is still refused", async () => {
    assert.equal(await read("mayAsk", [LANDLORD.address, LABEL, IDENTITY]), false);
  });

  test("permittedSets reports the whole surface in one call", async () => {
    const [income, identity, tenancy, employment] = await read("permittedSets", [LANDLORD.address, LABEL]);
    assert.equal(income, true);
    assert.equal(identity, false);
    assert.equal(tenancy, false);
    assert.equal(employment, false);
  });

  test("revoking takes it away again", async () => {
    await revoke(LABEL, ROLE_ASK_INCOME, LANDLORD.address);
    assert.equal(await read("mayAsk", [LANDLORD.address, LABEL, INCOME]), false);
  });
});

describe("scoping", () => {
  test("a role on one name does not leak to another name", async () => {
    const other = BigInt(keccak256(toHex("someone-else")));
    await grant(LABEL, ROLE_ASK_INCOME, LANDLORD.address);
    assert.equal(await read("mayAsk", [LANDLORD.address, LABEL, INCOME]), true);
    assert.equal(await read("mayAsk", [LANDLORD.address, other, INCOME]), false);
    await revoke(LABEL, ROLE_ASK_INCOME, LANDLORD.address);
  });

  test("a role on ROOT_RESOURCE counts everywhere - matching the real registry's OR", async () => {
    const any = BigInt(keccak256(toHex("any-name-at-all")));
    await grant(ROOT_RESOURCE, ROLE_ASK_INCOME, LANDLORD.address);
    assert.equal(await read("mayAsk", [LANDLORD.address, any, INCOME]), true);
    await revoke(ROOT_RESOURCE, ROLE_ASK_INCOME, LANDLORD.address);
    assert.equal(await read("mayAsk", [LANDLORD.address, any, INCOME]), false);
  });

  test("a different asker is unaffected by someone else's grant", async () => {
    await grant(LABEL, ROLE_ASK_INCOME, LANDLORD.address);
    assert.equal(await read("mayAsk", [DEPLOYER.address, LABEL, INCOME]), false);
    await revoke(LABEL, ROLE_ASK_INCOME, LANDLORD.address);
  });
});

describe("guards", () => {
  test("an unknown question set reverts instead of silently returning false", async () => {
    await assert.rejects(
      () => read("mayAsk", [LANDLORD.address, LABEL, keccak256(toHex("medical-history"))]),
      (e) => /UnknownQuestionSet|reverted/i.test(String(e)),
    );
  });

  test("mapQuestionSet is steward-only", async () => {
    const asLandlord = createWalletClient({ account: LANDLORD, chain: hardhat, transport });
    await assert.rejects(
      () => asLandlord.writeContract({ address: gate, abi: gateAbi, functionName: "mapQuestionSet", args: ["medical", 1n << 56n] }),
      (e) => /NotSteward|reverted/i.test(String(e)),
    );
  });

  test("the steward cannot map an illegal bitmap even deliberately", async () => {
    await assert.rejects(
      () => wal.writeContract({ address: gate, abi: gateAbi, functionName: "mapQuestionSet", args: ["medical", ILLEGAL] }),
      (e) => /InvalidRoleBitmap|reverted/i.test(String(e)),
    );
  });

  test("the steward can add a legal set", async () => {
    const hash = await wal.writeContract({ address: gate, abi: gateAbi, functionName: "mapQuestionSet", args: ["medical", 1n << 56n] });
    await pub.waitForTransactionReceipt({ hash });
    assert.equal(await read("roleOf", ["medical"]), 1n << 56n);
  });
});
