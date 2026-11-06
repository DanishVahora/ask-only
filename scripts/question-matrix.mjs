/**
 * AskOnly — ask the enclave a spread of questions nobody templated.
 *
 *   node --env-file=.env scripts/question-matrix.mjs
 *
 * Questions are free text now, so the thing to check is no longer "does the
 * one template work". It is: does an arbitrary question get a sensible answer,
 * does minimisation still withhold the sensitive lines, and does a question the
 * document cannot answer fail honestly rather than guessing.
 */

import { ask, leaksDocument } from "../src/ask/enclave.mjs";

const DOC = `
Tata Consultancy Services Limited
Employee: Danish Vahora
PAN: ABCDE1234F
Bank Account: HDFC 50100234567891
Address: 14 Hill Road, Bandra West, Mumbai 400050
Date of Joining: 2023-07-10
Designation: Senior Engineer
Gross: 68,000
Net Pay: 62,960
`.trim();

/** Lines a verifier must never be able to pull toward the enclave. */
const SENSITIVE = ["ABCDE1234F", "50100234567891", "Hill Road", "400050"];

const CASES = [
  { q: "Can they afford rent of 25,000 a month?", expect: "yes" },
  { q: "Do they earn more than 8 lakh a year?", expect: "yes" },
  { q: "Is their monthly take-home over 1 lakh?", expect: "no" },
  { q: "Have they worked there longer than a year?", expect: "yes" },
  { q: "Is the name on this document Danish Vahora?", expect: "yes" },
  { q: "Are they a senior engineer?", expect: "yes" },
  { q: "Is their blood group O negative?", expect: "refuse" },
];

const key = process.env.ZEROG_API_KEY;
if (!key) throw new Error("ZEROG_API_KEY is not set");

let pass = 0;
let fail = 0;
let leaked = 0;

console.log(`\n${CASES.length} questions, none of them templated\n`);

for (const c of CASES) {
  try {
    const r = await ask({ plaintext: DOC, question: c.q, apiKey: key });

    // the enclave must never receive a sensitive line, whatever was asked
    const sawSensitive = SENSITIVE.filter((x) => r.minimisation.extractIncluded?.includes?.(x));
    const echoed = leaksDocument(r, DOC);
    if (echoed) leaked += 1;

    const right = c.expect === "refuse" ? false : r.answer === c.expect;
    if (right) pass += 1;
    else fail += 1;

    console.log(`${right ? "PASS" : "FAIL"}  ${c.q}`);
    console.log(
      `      ${r.answer.toUpperCase()}${r.band ? " · " + r.band : ""}` +
        `   ${r.minimisation.keptLines}/${r.minimisation.totalLines} lines` +
        `   ${(r.latencyMs / 1000).toFixed(1)}s   $${r.costUsd.toFixed(5)}` +
        `${echoed ? "   !! ECHOED A FIGURE" : ""}${sawSensitive.length ? "   !! SENSITIVE LINE SENT" : ""}`,
    );
    if (r.why) console.log(`      "${r.why}"`);
  } catch (e) {
    const wanted = c.expect === "refuse";
    if (wanted) {
      pass += 1;
      console.log(`PASS  ${c.q}`);
      console.log(`      refused cleanly: ${e.kind ?? "error"}`);
    } else {
      fail += 1;
      console.log(`FAIL  ${c.q}`);
      console.log(`      ${e.message.slice(0, 100)}`);
    }
  }
  console.log();
}

console.log(`${pass} as expected, ${fail} not, ${leaked} leaked a figure.`);
process.exit(fail || leaked ? 1 : 0);
