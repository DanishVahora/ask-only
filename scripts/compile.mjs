/**
 * AskOnly — compile the contracts with solc directly.
 *
 *   npm run compile
 *
 * No framework in the compile path on purpose: solc's JSON interface is stable,
 * the output lands where the deploy script and the tests both read it, and there
 * is nothing between the source and the bytecode that can surprise us at 3am.
 *
 * Writes build/<Name>.json = { abi, bytecode, metadata }.
 */

import solc from "solc";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "contracts");
const OUT = path.join(ROOT, "build");

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) found.push(...walk(p));
    else if (name.endsWith(".sol")) found.push(p);
  }
  return found;
}

const files = walk(SRC);
if (files.length === 0) {
  console.error("no .sol files under contracts/");
  process.exit(1);
}

const sources = {};
for (const file of files) {
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  sources[rel] = { content: readFileSync(file, "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "metadata"] } },
  },
};

console.log(`solc ${solc.version()}`);
const out = JSON.parse(solc.compile(JSON.stringify(input)));

let fatal = 0;
for (const e of out.errors ?? []) {
  if (e.severity === "error") {
    fatal += 1;
    console.error(`\nERROR ${e.formattedMessage}`);
  } else {
    // Warnings are not noise to be ignored - print them, every time.
    console.warn(`warning: ${e.formattedMessage?.split("\n")[0] ?? e.message}`);
  }
}
if (fatal) {
  console.error(`\n${fatal} compile error(s).`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [file, contracts] of Object.entries(out.contracts ?? {})) {
  for (const [name, c] of Object.entries(contracts)) {
    const bytecode = `0x${c.evm.bytecode.object}`;
    if (bytecode === "0x") continue; // interface or abstract - nothing to deploy
    writeFileSync(
      path.join(OUT, `${name}.json`),
      JSON.stringify({ contractName: name, sourceFile: file, abi: c.abi, bytecode }, null, 2),
    );
    const size = (bytecode.length - 2) / 2;
    console.log(`  ${name.padEnd(20)} ${String(size).padStart(6)} bytes${size > 24576 ? "  !! OVER THE 24576-BYTE EIP-170 LIMIT" : ""}`);
    n += 1;
  }
}
console.log(`\nwrote ${n} artifact(s) to build/`);
