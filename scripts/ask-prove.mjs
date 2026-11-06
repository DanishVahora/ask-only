/**
 * AskOnly — prove the enclave path.
 *
 *   node --env-file=.env scripts/ask-prove.mjs
 *
 * Checks the things that would otherwise be claims in a README:
 * that minimisation really withholds data, that a real question gets a real
 * answer from a verified TeeML enclave, that no figure leaks, and that the
 * failure modes fail closed rather than producing a confident wrong answer.
 */

import { ask, assertTeeML, leaksDocument, EnclaveError, PINNED_PROVIDER } from "../src/ask/enclave.mjs";
import { minimalExtract, canonicalQuestion } from "../src/ask/questions.mjs";

const apiKey = process.env.ZEROG_API_KEY;
if (!apiKey) throw new Error("ZEROG_API_KEY is not set");

let fails = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { fails += 1; console.log(`  FAIL  ${m}`); };

/* A realistic Indian payslip, with plenty the landlord has no business seeing. */
const PAYSLIP = `
Tata Consultancy Services Limited
Employee: Danish Vahora
Employee ID: TCS-442913
PAN: ABCDE1234F
Bank Account: HDFC 50100234567891
Address: 14 Hill Road, Bandra West, Mumbai 400050
Designation: Senior Engineer
Date of Joining: 2023-07-10
Month: October 2026
Basic: 42,000
HRA: 16,800
Special Allowance: 9,200
Gross: 68,000
Provident Fund: 5,040
Professional Tax: 200
Net Pay: 62,960
`.trim();

/* ------------------------------------------------- 1. minimisation */
console.log("\n[1] minimisation - the enclave must not receive the whole document");
const m = minimalExtract(PAYSLIP, "income");
console.log(`      kept ${m.keptLines}/${m.totalLines} lines, dropped ${m.droppedLines}`);
const mustNotLeak = ["PAN", "ABCDE1234F", "50100234567891", "Hill Road", "400050", "TCS-442913"];
const leaked = mustNotLeak.filter((s) => m.extract.includes(s));
if (leaked.length) bad(`the extract still contains: ${leaked.join(", ")}`);
else ok(`PAN, bank account, address and employee id are all absent from the extract`);
if (!/Gross|Net Pay/i.test(m.extract)) bad("the extract dropped the lines the question needs");
else ok("the lines bearing on income survived");

/* ------------------------------------------------- 2. provider attestation */
console.log("\n[2] provider attestation - refuse anything that is not TeeML");
try {
  const a = await assertTeeML("glm-5.3", apiKey);
  ok(`pinned ${a.pinned.address.slice(0, 10)}... ${a.pinned.teeType}/${a.pinned.teeVerifier}, healthy=${a.pinned.healthy}`);
  if (a.pinned.address.toLowerCase() !== PINNED_PROVIDER.toLowerCase()) {
    bad(`pinned provider drifted to ${a.pinned.address}`);
  } else ok("pinned provider is the expected TDX/dstack enclave");
  ok(`${a.nonTee.length} non-TEE provider(s) serve the same model: ${a.nonTee.map((p) => p.name).join(", ") || "none"}`);
} catch (e) {
  bad(`assertTeeML: ${e.message}`);
}

/* ------------------------------------------------- 3. the real ask */
console.log("\n[3] a permitted question, end to end");
try {
  const r = await ask({ plaintext: PAYSLIP, setName: "income", param: "50000", apiKey });
  console.log(`      question  "${r.question}"`);
  console.log(`      answer    ${r.answer.toUpperCase()}   band="${r.band}"  why="${r.why}"`);
  console.log(`      provider  ${r.provider} (${r.providerName}) pinned=${r.providerPinned}`);
  console.log(`      tee       ${r.teeType} attested=${r.teeAttested} trustMode=${r.trustMode}`);
  console.log(`      requestId ${r.requestId}`);
  console.log(`      verify    ${r.verification}`);
  console.log(`      latency   ${r.latencyMs}ms   cost $${r.costUsd.toFixed(6)}`);
  console.log(`      saw       ${r.minimisation.keptLines}/${r.minimisation.totalLines} lines`);

  if (r.answer !== "yes") bad(`expected yes for 68,000 > 50,000, got ${r.answer}`);
  else ok("the enclave answered YES, which is correct");
  if (r.verification !== "provider-address") bad(`verification claims "${r.verification}"`);
  else ok('verification is honestly labelled "provider-address", not "signature"');
  if (!r.requestId) bad("no request id to show - the 0G prize asks for visible request ids");
  else ok("a visible request id came back");
  if (leaksDocument(r, PAYSLIP)) bad(`the answer leaked a figure: band="${r.band}" why="${r.why}"`);
  else ok("no figure from the document appears anywhere in the answer");
  if (r.questionHash?.length !== 64 || r.answerHash?.length !== 64) bad("hashes are malformed");
  else ok("question and answer hashes are well formed for the receipt");
} catch (e) {
  bad(`ask: ${e.message}`);
}

/* ------------------------------------------------- 4. the opposite answer */
console.log("\n[4] the same document against a threshold it does NOT clear");
try {
  const r = await ask({ plaintext: PAYSLIP, setName: "income", param: "500000", apiKey });
  console.log(`      "${r.question}" -> ${r.answer.toUpperCase()}  why="${r.why}"`);
  if (r.answer !== "no") bad(`expected no for 68,000 > 500,000, got ${r.answer}`);
  else ok("answers NO when the threshold is not met - it is reading, not agreeing");
  if (leaksDocument(r, PAYSLIP)) bad(`leaked a figure: ${r.why}`);
  else ok("still no figure leaked");
} catch (e) {
  bad(`ask: ${e.message}`);
}

/* ------------------------------------------------- 5. fail closed */
console.log("\n[5] failure modes must fail closed");
try {
  minimalExtract("Just a photo of a cat.\nNothing financial here.", "income");
  bad("a document with nothing relevant was accepted - the model would guess from the question");
} catch {
  ok("a document with no relevant lines is refused rather than sent");
}
try {
  canonicalQuestion("medical-history", "x");
  bad("an unknown question set was accepted");
} catch {
  ok("an unknown question set is refused");
}
try {
  await ask({ plaintext: PAYSLIP, setName: "income", param: "50000", apiKey: "sk-not-a-real-key" });
  bad("a bad key still produced an answer");
} catch (e) {
  if (e instanceof EnclaveError) ok(`a bad key fails cleanly: ${e.kind}`);
  else ok(`a bad key fails: ${String(e.message).slice(0, 60)}`);
}

console.log(fails ? `\n${fails} check(s) failed.\n` : `\nENCLAVE PATH GREEN - every claim above was measured.\n`);
process.exit(fails ? 1 : 0);
