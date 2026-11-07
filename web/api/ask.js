/**
 * The landing page's live demo: a real 0G TEE enclave answering a question about the
 * PUBLIC sample payslip that is printed on the page.
 *
 * No one's data touches this. The document is the made-up payslip in
 * src/components/landing/payslip.js, the lines sent are picked by the app's own code
 * (src/lib/questions.js), and the call is the app's own (askEnclaveDirect: TeeML
 * machines only, and an answer from anything else is thrown away). It is what the app
 * does, on a document anyone can already read, from a server because 0G's router lets
 * only a page on localhost:5173 call it from a browser.
 *
 * It spends the operator's 0G credit, so it is small on purpose: one short question,
 * a few a minute per instance, and a repeated question is answered from memory.
 */
import { ANY_TOPIC, NEEDS_WIDENING, enclaveRequest, extractStages } from "../src/lib/questions.js";
import { askEnclaveDirect } from "../src/lib/askonly.js";
import { LINES } from "../src/components/landing/payslip.js";

export const maxDuration = 60;

const TEXT = LINES.join("\n");
const QUESTION_MAX = 120;
const PER_MINUTE = 12;
// Vercel runs many instances and each starts at zero, so the per-minute limit alone
// does not bound the spend. This caps what any one instance can ever spend.
const PER_INSTANCE = 60;
let spent = 0;
const recent = [];
const answered = new Map(); // normalised question -> the reply, for this instance

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST a question" });
  }
  const key = process.env.ZEROG_API_KEY;
  if (!key) return res.status(503).json({ error: "this copy has no 0G key, so it cannot ask" });

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const question = String(body?.question ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!question || question.length > QUESTION_MAX) {
    return res.status(400).json({ error: `ask one question, up to ${QUESTION_MAX} characters` });
  }

  const norm = question.toLowerCase().replace(/\s+/g, " ").replace(/[?.!\s]+$/, "");
  if (answered.has(norm)) return res.status(200).json({ ...answered.get(norm), repeated: true });

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= PER_MINUTE || spent >= PER_INSTANCE) {
    return res.status(429).json({ error: "the live demo is busy, try again in a minute", retryAfterMs: 60_000 });
  }
  recent.push(now);
  spent += 1;

  // Narrowest first, widening only when those lines cannot settle it: the app's own loop.
  const stages = extractStages(TEXT, question, ANY_TOPIC);
  if (!stages.length) return res.status(400).json({ error: "nothing to ask about" });
  let last = null;
  try {
    for (const stage of stages) {
      const result = await askEnclaveDirect(enclaveRequest(question, stage.extract, { scope: ANY_TOPIC }), key);
      last = { result, stage };
      if (!NEEDS_WIDENING(result)) break;
    }
  } catch (e) {
    const busy = Boolean(e?.busy);
    return res.status(busy ? 503 : 502).json({ error: String(e?.message ?? e).slice(0, 200), busy });
  }

  const { result, stage } = last;
  const reply = {
    answer: result.answer,
    band: result.band || "",
    requestId: result.enclaveRequestId,
    provider: result.provider,
    model: result.model,
    teeType: result.teeType,
    // How much the enclave actually read: the first stage, or a wider one if it had to.
    linesShown: stage.keptLines,
    totalLines: stage.totalLines,
    widened: stages.indexOf(stage) > 0,
    latencyMs: result.latencyMs,
  };
  answered.set(norm, reply);
  return res.status(200).json(reply);
}
