/**
 * AskOnly — P0 preflight.
 *
 * Proves all three sponsor integrations are live with a real call each, BEFORE any
 * feature code is written. Every line it prints is a measurement, not an assumption.
 *
 *   npm run preflight
 */

import { createPublicClient as viemPublicClient, http as viemHttp, keccak256, toHex } from "viem";
import { readOnly, preflight, account, scrub, RABDI_CHAIN_ID, FAUCET } from "../src/arkiv/client.mjs";
import { QUESTION_SETS, isLegalRoleBitmap, ALL_ROLES } from "../src/arkiv/schema.mjs";

const PASS = "  PASS";
const FAIL = "  FAIL";
let failures = 0;

const line = (s = "") => console.log(s);
const ok = (msg) => line(`${PASS}  ${msg}`);
const bad = (msg) => {
  failures += 1;
  line(`${FAIL}  ${msg}`);
};

/* ---------------------------------------------------------------- 1. ARKIV */
line("\n[1/4] ARKIV - Rabdi testnet");
let acct = null;
try {
  acct = account();
  line(`       writing wallet ${acct.address}`);
  const info = await preflight(readOnly(), acct.address);
  ok(`chain ${info.chainId} (expected ${RABDI_CHAIN_ID}), block ${info.block}`);
  if (info.funded) {
    ok(`balance ${info.balance} tGLM`);
  } else {
    bad(`balance 0 tGLM  <- NEEDS FAUCET before any write: ${FAUCET}`);
  }
} catch (e) {
  bad(`arkiv: ${scrub(e)}`);
}

/* --------------------------------------------------- 2. ARKIV QUERY SHAPES */
line("\n[2/4] ARKIV - query shapes (reads cost no gas)");
try {
  const { Grant, Access } = await import("../src/arkiv/schema.mjs");
  const { eq, and, desc } = await import("@arkiv-network/sdk/query");
  const { str, addr } = await import("@arkiv-network/sdk/schema");
  const reader = readOnly();

  // A malformed query THROWS QueryError rather than returning empty, so merely
  // being accepted by the network is the proof that the syntax is sound.
  const live = await reader
    .select({ $key: true, $expiresAt: true, grantId: true, state: true, questionSet: true })
    .from(Grant)
    .where(eq("state", str("live")))
    .orderBy(desc("issuedAt"))
    .limit(5)
    .fetch();
  ok(`grant query accepted, ${live.entities.length} row(s)`);

  const mine = await reader
    .select({ accessId: true, answer: true, requestId: true })
    .from(Access)
    .where(and(eq("owner", addr(acct?.address ?? "0x".padEnd(42, "0"))), eq("answer", str("yes"))))
    .limit(5)
    .fetch();
  ok(`compound access query accepted, ${mine.entities.length} row(s)`);
} catch (e) {
  bad(`arkiv query: ${scrub(e)}`);
}

/* ------------------------------------------------------------- 3. ENSv2 */
line("\n[3/4] ENSv2 - live registry on Sepolia");
const ETH_REGISTRY = "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4";
const EAC_ABI = [
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    // The first parameter is a uint256, NOT a bytes32. With bytes32 it reverts and
    // the revert looks like a permissions failure rather than a signature mismatch.
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
];
try {
  const sepolia = viemPublicClient({
    transport: viemHttp(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
  });
  const [chainId, code] = await Promise.all([
    sepolia.getChainId(),
    sepolia.getCode({ address: ETH_REGISTRY }),
  ]);
  if (Number(chainId) !== 11155111) bad(`sepolia chain id ${chainId}, expected 11155111`);
  else ok(`sepolia chain ${chainId}`);
  if (!code || code === "0x") bad(`no bytecode at ETHRegistry ${ETH_REGISTRY}`);
  else ok(`ETHRegistry has ${(code.length - 2) / 2} bytes of code`);

  // Ask the REAL registry a real question: does this address hold the income role?
  // Expected false - we have granted nothing yet. What matters is that it answers
  // rather than reverting, which is what proves the ABI encoding is right.
  const probe = "0x0000000000000000000000000000000000000001";
  const res = await sepolia.readContract({
    address: ETH_REGISTRY,
    abi: EAC_ABI,
    functionName: "hasRoles",
    args: [0n, QUESTION_SETS.income.roleBit, probe],
  });
  ok(`hasRoles(ROOT, income, ${probe.slice(0, 10)}...) -> ${res}  (live call answered)`);

  for (const [name, set] of Object.entries(QUESTION_SETS)) {
    if (!isLegalRoleBitmap(set.roleBit)) {
      bad(`role bitmap for "${name}" would be rejected as EACInvalidRoleBitmap`);
    }
  }
  if (!isLegalRoleBitmap(0xfn << 40n)) {
    ok(`bitmap legality check works (0xF<<40 correctly rejected; ALL_ROLES has ${ALL_ROLES.toString(16).length} nybbles)`);
  } else {
    bad("legality check is wrong - it accepted 0xF<<40, which the live registry rejects");
  }
  ok(`4 question sets map to nybbles ${Object.values(QUESTION_SETS).map((s) => s.nybble).join(", ")}`);
} catch (e) {
  bad(`ens: ${scrub(e)}`);
}

/* ---------------------------------------------------------------- 4. 0G PC */
line("\n[4/4] 0G Private Computer - TeeML provider");
const MODEL = "glm-5.3";
const PINNED = "0xD179F4526064846dE9a9E9D93683AF75CB72E503";
try {
  const base = process.env.ZEROG_BASE_URL || "https://router-api.0g.ai/v1";
  const key = process.env.ZEROG_API_KEY;
  if (!key) throw new Error("ZEROG_API_KEY is not set");

  const r = await fetch(`${base}/providers?model=${MODEL}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`/providers returned ${r.status}`);
  const { data = [] } = await r.json();

  const tee = data.filter((p) => p.verifiability === "TeeML");
  const plain = data.filter((p) => p.verifiability !== "TeeML");
  if (!tee.length) bad(`no TeeML provider for ${MODEL} - do NOT claim enclave execution`);
  else ok(`${tee.length} TeeML provider(s): ${tee.map((p) => `${p.provider_name || p.provider_identity}[${p.tee_type}/${p.tee_verifier}]`).join(", ")}`);
  if (plain.length) {
    ok(`${plain.length} NON-TEE provider(s) also serve ${MODEL} (${plain.map((p) => p.provider_identity || p.provider_name).join(", ")}) - this is why assertTeeML() exists`);
  }

  const pin = data.find((p) => String(p.address).toLowerCase() === PINNED.toLowerCase());
  if (!pin) bad(`pinned provider ${PINNED} not in the list`);
  else if (!pin.is_healthy) bad(`pinned provider ${PINNED} is UNHEALTHY`);
  else ok(`pinned ${PINNED} healthy, trust_mode=${pin.trust_mode}, modality=${pin.architecture?.modality}`);

  // A real question, in private trust mode, with the max_tokens floor.
  const t0 = Date.now();
  const body = {
    model: MODEL,
    max_tokens: 1500,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You are a sealed policy enclave. Answer ONLY the permitted question. Reply as JSON {"answer":"yes"|"no"|"unknown","band":"","confidence":0.0,"why":""}. Never reveal any figure, name or detail from the document.',
      },
      {
        role: "user",
        content:
          "PERMITTED QUESTION: Is monthly income above INR 50000?\n\nDOCUMENT (payslip extract):\nGross: 68,000\nNet Pay: 62,960\n",
      },
    ],
  };
  const c = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-0G-Provider-Trust-Mode": "private",
    },
    body: JSON.stringify(body),
  });
  if (c.status === 503) throw new Error("503 - private mode found no TeeML provider; retry, never relax trust mode");
  if (!c.ok) throw new Error(`chat/completions returned ${c.status}`);
  const j = await c.json();
  const ms = Date.now() - t0;

  const content = j.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    bad("EMPTY completion - raise max_tokens. An empty string must NEVER be parsed as an answer.");
  } else {
    const parsed = JSON.parse(content);
    ok(`enclave answered "${parsed.answer}" in ${ms}ms (${j.usage?.completion_tokens} completion / ${j.usage?.reasoning_tokens} reasoning tokens)`);
    if (/68|62,?960/.test(content)) bad("the answer LEAKED a figure from the document");
    else ok("no figure from the document appears in the reply");
  }
  const trace = j.x_0g_trace ?? {};
  if (String(trace.provider).toLowerCase() !== PINNED.toLowerCase()) {
    bad(`answered by ${trace.provider}, not the pinned TeeML provider`);
  } else {
    ok(`x_0g_trace.provider == pinned enclave`);
  }
  ok(`request_id ${trace.request_id}  cost $${(Number(trace.billing?.total_cost_usd_micro ?? 0) / 1e6).toFixed(6)}`);
} catch (e) {
  bad(`0g: ${String(e?.message || e).slice(0, 200)}`);
}

/* ------------------------------------------------------------------ RESULT */
line();
if (failures) {
  line(`PREFLIGHT FAILED - ${failures} check(s) need fixing before feature code.`);
  process.exit(1);
}
line("PREFLIGHT GREEN - Arkiv, ENSv2 and the 0G enclave all answered live.");
line("Gate passed: feature code may begin.\n");
