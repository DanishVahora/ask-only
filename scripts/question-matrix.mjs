/**
 * AskOnly — ask the enclave a spread of questions nobody templated, through ask().
 *
 *   node --env-file=.env scripts/question-matrix.mjs
 *
 * This is the quick check of the server's path, the one the hosted relay uses. The
 * thorough one, across many documents and in the browser's order, is
 * scripts/accuracy-matrix.mjs.
 *
 * Questions are free text, so the thing to check is not "does the one template work".
 * It is: does an arbitrary question get a sensible answer, does a question the document
 * cannot answer stay an honest unknown, and does nothing come back that the asker
 * should not see.
 *
 * It starts with a check that costs nothing and fails hard: identifiers stay out of the
 * narrow stage unless the question is about them. "Are they still employed there?" used
 * to match "Employee:" and bring in the PAN printed under it as a neighbour, which is
 * the exact thing the product says it does not do.
 *
 * The whole-document stage does read them, still inside the enclave, when the narrow one
 * cannot settle the question. So which of those lines the enclave saw is reported for
 * every live question. What the ASKER sees stays a hard failure.
 */

import { ask, leaksDocument } from "../src/ask/enclave.mjs";
import { extractStages, ANY_TOPIC } from "../src/ask/questions.mjs";

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

/** Lines nobody asked about, reported whenever the enclave was shown them. */
const SENSITIVE = ["ABCDE1234F", "50100234567891", "Hill Road", "400050"];

/** The sample on the landing page, which promises this. Lines fall differently here. */
const LANDING = `
Tata Consultancy Services Limited
Employee: Asha Rao
Employee ID: TCS-442913
PAN: ABCDE1234F
Bank Account: HDFC 50100234567891
Address: 14 Hill Road, Bandra West
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

/** How PDF text really comes out: an identifier sharing a line with what matters. */
const MESSY = `
Tata Consultancy Services Limited
9th Floor, Nirmal Building, Nariman Point, Mumbai 400021
PAYSLIP FOR THE MONTH OF OCTOBER 2026
Emp Code 442913 Emp Name Danish Vahora
Designation Senior Engineer Department Digital Engineering
DOJ 10-Jul-2023 PAN ABCDE1234F UAN 100934512876
Bank HDFC Bank A/c No 50100234567891
Home Address 14 Hill Road, Bandra West, Mumbai 400050
Days Paid 31 LOP 0
Basic 42,000.00 Provident Fund 5,040.00
Gross Earnings 68,000.00 Total Deductions 8,340.00
NET PAY 59,660.00
`.trim();

const IDENTIFIERS = ["442913", "ABCDE1234F", "100934512876", "50100234567891", "Hill Road", "400050", "Nirmal Building"];

/** Not about any identifier, so none of them belongs in the narrow stage. */
const NOT_ABOUT_THEM = [
  "Are they still employed there?",
  "is he employed?",
  "Have they worked there for over a year?",
  "Did they join before 2024?",
  "Can they afford rent of ₹25,000 a month?",
  "Do they earn over ₹2 lakh a month?",
  "Are they a senior engineer?",
  "Is the name on this document Danish Vahora?",
  "does he work at tata",
  "does he have a job",
];

/** About one: what may show, and what still may not. */
const ABOUT_THEM = [
  { q: "What is their PAN number?", shows: ["[withheld]"], hides: ["ABCDE1234F"] },
  { q: "Is their PAN ABCDE1234F?", shows: ["ABCDE1234F"], hides: ["50100234567891"] },
  { q: "does their bank account end in 7891", shows: ["50100234567891"], hides: ["ABCDE1234F"] },
  { q: "does he have a bank account", shows: ["[withheld]"], hides: ["50100234567891", "ABCDE1234F"] },
  { q: "where do they live", shows: ["Hill Road"], hides: ["ABCDE1234F", "50100234567891"] },
  { q: "is his address in bandra", shows: ["Hill Road"], hides: ["ABCDE1234F", "50100234567891"] },
];

/** A date printed beside a PAN still has to reach the question it answers. */
const KEEPS_WHAT_MATTERS = [{ q: "Did they join before 2024?", shows: ["10-Jul-2023"], hides: ["ABCDE1234F"] }];

function checkNarrowStages() {
  const wrong = [];
  const narrow = (doc, q, scope = "") => {
    const stages = extractStages(doc, q, scope);
    return stages.length > 1 ? stages[0].extract : null;
  };
  for (const [name, doc] of [["fixture", DOC], ["landing", LANDING], ["messy", MESSY]]) {
    const whole = extractStages(doc, "is he married", ANY_TOPIC).at(-1).extract;
    for (const id of IDENTIFIERS.filter((x) => doc.includes(x))) {
      if (!whole.includes(id)) wrong.push(`${name}: the whole-document stage lost ${id}`);
    }
    for (const q of NOT_ABOUT_THEM) {
      const seen = narrow(doc, q);
      if (seen === null) continue; // nothing matched, so there is no narrow stage to check
      for (const id of IDENTIFIERS) if (seen.includes(id)) wrong.push(`${name}: "${q}" put ${id} in the narrow stage`);
    }
    for (const { q, shows, hides } of ABOUT_THEM) {
      const seen = narrow(doc, q);
      if (seen === null) { wrong.push(`${name}: "${q}" has no narrow stage, so it would read everything`); continue; }
      if (!shows.some((x) => seen.includes(x))) wrong.push(`${name}: "${q}" should show ${shows.join(" or ")}`);
      for (const id of hides) if (seen.includes(id)) wrong.push(`${name}: "${q}" put ${id} in the narrow stage`);
    }
  }
  for (const { q, shows, hides } of KEEPS_WHAT_MATTERS) {
    const seen = narrow(MESSY, q) ?? "";
    for (const x of shows) if (!seen.includes(x)) wrong.push(`messy: "${q}" lost ${x}, the line that answers it`);
    for (const x of hides) if (seen.includes(x)) wrong.push(`messy: "${q}" put ${x} in the narrow stage`);
  }
  // Every other line of the landing page's sample stays back for its own example too.
  const rent = narrow(LANDING, "Can they afford rent of ₹25,000 a month?");
  for (const x of ["Tata Consultancy", "Asha Rao", "TCS-442913", "Senior Engineer"]) {
    if (rent?.includes(x)) wrong.push(`landing: the rent question shows ${x}, and the page says it does not`);
  }
  return wrong;
}

const wrongStages = checkNarrowStages();
if (wrongStages.length) {
  console.log("\nIdentifiers got into the narrow stage. Nothing was sent:\n");
  for (const w of wrongStages) console.log(`  ${w}`);
  process.exit(1);
}
console.log(`\nIdentifiers stay out of the narrow stage: ${NOT_ABOUT_THEM.length + ABOUT_THEM.length + KEEPS_WHAT_MATTERS.length} questions over 3 payslips.`);

const CASES = [
  { q: "Can they afford rent of 25,000 a month?", expect: "yes" },
  { q: "Do they earn more than 8 lakh a year?", expect: "yes" },
  { q: "Is their monthly take-home over 1 lakh?", expect: "no" },
  { q: "Have they worked there longer than a year?", expect: "yes" },
  { q: "Is the name on this document Danish Vahora?", expect: "yes" },
  { q: "Are they a senior engineer?", expect: "yes" },
  { q: "Does he work at TCS?", expect: "yes" },
  { q: "Are they still employed there?", expect: "yes" },
  { q: "Did they join before 2024?", expect: "yes" },
  // Asked about an identifier, it still works, and the value still does not come back.
  { q: "What is their PAN number?", expect: "unknown" },
  { q: "Is their PAN ABCDE1234F?", expect: "yes" },
  { q: "Do they have a bank account?", expect: "yes" },
  // Used to be "refuse", when no matching line meant refusing to ask at all. The
  // question is allowed and the document has nothing on it, so the honest answer is
  // unknown, and it takes reading all of it to say so.
  { q: "Is their blood group O negative?", expect: "unknown" },
  { q: "Is their blood group O negative?", scope: ANY_TOPIC, expect: "unknown" },
  // Outside what the owner allowed: turned down, and with nothing read to do it.
  { q: "Is their blood group O negative?", scope: "income", expect: "refuse" },
  { q: "Can they afford rent of 25,000 a month?", scope: "income", expect: "yes" },
];

const key = process.env.ZEROG_API_KEY;
if (!key) throw new Error("ZEROG_API_KEY is not set");

let pass = 0;
let fail = 0;
let leaked = 0;

console.log(`\n${CASES.length} questions, none of them templated\n`);

for (const c of CASES) {
  const label = `${c.q}${c.scope ? `   (topic: ${c.scope})` : ""}`;
  try {
    const r = await ask({ plaintext: DOC, question: c.q, scope: c.scope ?? "", apiKey: key });
    const got = r.outOfScope ? "refuse" : r.answer;

    const m = r.minimisation;
    const shown = extractStages(DOC, c.q, c.scope ?? "")[m.stage - 1];
    const saw = SENSITIVE.filter((x) => shown.extract.includes(x));

    const echoed = leaksDocument(r, DOC);
    if (echoed) leaked += 1;

    const right = got === c.expect;
    if (right) pass += 1;
    else fail += 1;

    console.log(`${right ? "PASS" : "FAIL"}  ${label}`);
    console.log(
      `      ${got.toUpperCase()}${r.band ? " · " + r.band : ""}   expected ${c.expect}` +
        `   ${m.keptLines}/${m.totalLines} lines, stage ${m.stage} of ${m.stages}` +
        `   ${(r.latencyMs / 1000).toFixed(1)}s   $${r.costUsd.toFixed(5)}` +
        `${echoed ? "   !! ECHOED A FIGURE" : ""}`,
    );
    if (saw.length) console.log(`      the enclave saw: ${saw.join(", ")}`);
    if (r.why) console.log(`      "${r.why}"`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${label}`);
    console.log(`      ${e.kind ?? "error"}: ${e.message.slice(0, 100)}`);
  }
  console.log();
}

console.log(`${pass} as expected, ${fail} not, ${leaked} leaked a figure.`);
process.exit(fail || leaked ? 1 : 0);
