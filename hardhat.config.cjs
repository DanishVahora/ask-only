/**
 * Hardhat is here for exactly one reason: a local chain to test against.
 *
 * Compilation does NOT go through hardhat - `npm run compile` calls solc directly
 * (scripts/compile.mjs) and writes build/<Name>.json, which both the tests and the
 * deploy script read. Keeping the compile path framework-free means there is
 * nothing between the source and the bytecode that can surprise us.
 *
 * Port 8546, not 8545: another project on this machine already holds 8545, and a
 * test suite that silently talks to someone else's chain is a bad night.
 */
module.exports = {
  solidity: { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: { hardhat: { chainId: 31337 } },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};
