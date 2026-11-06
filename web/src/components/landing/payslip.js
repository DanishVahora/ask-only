import { guessTopic, selectLines } from "../../lib/questions.js";

/* A sample payslip under a made-up name. Both the hero and the scroll story use it. */
export const LINES = [
  "Tata Consultancy Services Limited",
  "Employee: Asha Rao",
  "Employee ID: TCS-442913",
  "PAN: ABCDE1234F",
  "Bank Account: HDFC 50100234567891",
  "Address: 14 Hill Road, Bandra West",
  "Designation: Senior Engineer",
  "Date of Joining: 2023-07-10",
  "Month: October 2026",
  "Basic: 42,000",
  "HRA: 16,800",
  "Special Allowance: 9,200",
  "Gross: 68,000",
  "Provident Fund: 5,040",
  "Professional Tax: 200",
  "Net Pay: 62,960",
];

const TEXT = LINES.join("\n");

/**
 * The lines the enclave would be shown first, chosen by the app's own code, not a script
 * written for this page. Like extractStages(): if nothing matches, there is nothing
 * narrow to try and it starts with the whole document.
 */
export function linesFor(question) {
  const { suggested } = selectLines(TEXT, question, guessTopic(question));
  return new Set(suggested.length ? suggested : LINES.map((_, i) => i));
}

const CIPHER = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789+/";

/** What a line looks like encrypted. For show, and the same every time. */
export const cipherOf = (text) =>
  [...text]
    .map((c, i) => (c === " " ? " " : CIPHER[(c.charCodeAt(0) * 31 + i * 17 + text.length * 7) % CIPHER.length]))
    .join("");
