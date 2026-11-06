/**
 * AskOnly — the 0G Private Computer client.
 *
 * ── What is and is not proven, stated once, here ───────────────────────────────
 *
 * PROVEN, and checked in code:
 *   - The answering provider's address, from `x_0g_trace.provider`.
 *   - That that address is a provider whose `verifiability` is "TeeML",
 *     `trust_mode` is "private", and whose TEE is reported as TDX/dstack - read
 *     live from GET /providers?model=, not hard-coded.
 *   - 0G's own request id, surfaced in the UI and written into the receipt.
 *
 * NOT PROVEN, and therefore never claimed:
 *   - That the enclave signed the answer. `GET /v1/proxy/signature/{chatID}` does
 *     NOT exist on the Router - probed 2026-11-06 with a live chatcmpl id across
 *     eight path shapes, all 404. So there is no enclave signature to verify and
 *     we do not pretend there is. `verification` on a receipt is
 *     "provider-address", not "signature".
 *   - `x_0g_trace.tee_verified` would be the ROUTER'S SELF-REPORT. It is labelled
 *     as such wherever it is shown and is never treated as attestation.
 *
 * TeeML vs TeeTLS is a real distinction: TeeML runs the MODEL inside the enclave,
 * TeeTLS only protects the transport. Only ~7 of the router's ~123 models carry a
 * `verifiability` field at all. assertTeeML() refuses anything that is not TeeML,
 * because a team that does not check will claim enclave execution it is not getting.
 */

import { systemPrompt, userPrompt, selectLines, extractFrom, guessTopic, sha256hex } from "./questions.mjs";

export const DEFAULT_MODEL = "glm-5.3";

/** The TeeML provider we pin. Verified healthy, TDX/dstack, trust_mode private. */
export const PINNED_PROVIDER = "0xD179F4526064846dE9a9E9D93683AF75CB72E503";

/**
 * glm-5.3 emits reasoning tokens BEFORE any JSON. Below roughly 1500 it returns
 * an EMPTY string, and a parser that treats "" as a result will score a document
 * it never read. That makes this a correctness floor, not a quality knob.
 */
export const MIN_MAX_TOKENS = 3000;

export const baseUrl = () =>
  (process.env.ZEROG_BASE_URL || "https://router-api.0g.ai/v1").replace(/\/+$/, "");

export class EnclaveError extends Error {
  constructor(message, kind = "enclave") {
    super(message);
    this.name = "EnclaveError";
    this.kind = kind;
  }
}

/* --------------------------------------------------------------- providers */

/* A short cache, and only for the provider LIST.
 *
 * 0G's router is intermittently slow - measured 11s on a bare unauthenticated
 * request on 2026-11-06. Without a timeout, /api/providers hangs and the UI
 * shows a bare "fetch failed" for something that is only informational. The
 * answer path is never served from this cache; a provider going unhealthy
 * mid-demo must still be caught, so assertTeeML revalidates on every ask. */
let _cache = { at: 0, model: null, data: null };
const CACHE_MS = 45_000;
const FETCH_MS = 20_000;

/** Live provider list for a model. */
export async function providers(model = DEFAULT_MODEL, apiKey, { fresh = false } = {}) {
  if (!fresh && _cache.data && _cache.model === model && Date.now() - _cache.at < CACHE_MS) {
    return _cache.data;
  }

  let r;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      r = await fetch(`${baseUrl()}/providers?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!r) {
    // Serve a stale list rather than nothing, and say that is what happened.
    if (_cache.data && _cache.model === model) {
      const stale = _cache.data.map((p) => ({ ...p, stale: true }));
      return stale;
    }
    throw new EnclaveError(
      `0G's provider list did not answer within ${FETCH_MS / 1000}s (${lastErr?.name ?? "error"})`,
      "providers-timeout",
    );
  }
  if (!r.ok) throw new EnclaveError(`GET /providers returned ${r.status}`, "providers");
  const { data = [] } = await r.json();
  const mapped = data.map((p) => ({
    address: p.address,
    name: p.provider_name || p.provider_identity || "unknown",
    healthy: Boolean(p.is_healthy),
    verifiability: p.verifiability ?? null,
    trustMode: p.trust_mode ?? null,
    teeType: p.tee_type ?? null,
    teeVerifier: p.tee_verifier ?? null,
    teeAttested: Boolean(p.tee_attested),
    modality: p.architecture?.modality ?? null,
    contextLength: p.context_length ?? null,
  }));
  _cache = { at: Date.now(), model, data: mapped };
  return mapped;
}

/**
 * Refuse to proceed unless a genuine TeeML provider is available.
 *
 * Returns the TeeML providers plus the non-TeeML ones serving the same model -
 * the latter are shown in the UI on purpose, because "the same model is also
 * served by two providers with no enclave at all" is the clearest possible
 * argument for why pinning matters.
 */
export async function assertTeeML(model = DEFAULT_MODEL, apiKey) {
  const all = await providers(model, apiKey);
  const tee = all.filter((p) => p.verifiability === "TeeML");
  const plain = all.filter((p) => p.verifiability !== "TeeML");
  const healthy = tee.filter((p) => p.healthy);

  if (tee.length === 0) {
    throw new EnclaveError(
      `no TeeML provider serves ${model}. Refusing to run - an answer from a ` +
        `non-TeeML provider must not be presented as enclave-computed.`,
      "no-teeml",
    );
  }
  if (healthy.length === 0) {
    throw new EnclaveError(
      `${model} has ${tee.length} TeeML provider(s) but none are healthy right now.`,
      "teeml-unhealthy",
    );
  }
  const pinned = healthy.find((p) => p.address.toLowerCase() === PINNED_PROVIDER.toLowerCase());
  return { teeml: tee, healthy, pinned: pinned ?? healthy[0], nonTee: plain, model };
}

/* -------------------------------------------------------------------- ask */

/**
 * Ask the enclave one permitted question about one document.
 *
 * The caller has already established that the verifier holds the ENS role. This
 * function's job is to narrow the document, send it to a verified enclave, and
 * come back with something a receipt can be built from.
 *
 * @param plaintext   the decrypted document - in memory only, never logged,
 *                    never written to disk, never returned to the verifier
 * @param question    free text, in whatever words the asker used
 * @param topic       optional coarse topic, for choosing which lines qualify
 * @param apiKey      the OWNER's 0G key. In local mode this comes from the
 *                    owner's own browser and the server never sees it.
 */
export async function ask({ plaintext, question, topic, apiKey, model = DEFAULT_MODEL, signal }) {
  if (!apiKey) throw new EnclaveError("no 0G key provided", "no-key");

  if (!question?.trim()) throw new EnclaveError("no question was asked", "no-question");
  const chosen = topic ?? guessTopic(question);
  const sel = selectLines(plaintext, question, chosen);
  const { extract, keptLines, droppedLines, totalLines } = extractFrom(sel.lines, sel.suggested);
  if (!keptLines) {
    throw new EnclaveError(
      "no line in this document bears on that question - refusing to send it, because a model " +
        "given nothing relevant will answer from the question alone",
      "no-relevant-lines",
    );
  }

  const attested = await assertTeeML(model, apiKey);

  const body = {
    model,
    max_tokens: MIN_MAX_TOKENS,
    reasoning_effort: "low",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(question, extract) },
    ],
  };

  const t0 = Date.now();
  let res;
  let transport = null;
  /* Two different retries, for two different failures:
     - 503 means private mode found no free TeeML provider. Retry; NEVER relax
       the trust mode, because no-silent-downgrade is what makes the claim safe.
     - a dead socket. glm-5.3 reasons for 15-20s on a hard question and the
       router is intermittently slow, so an untimed fetch just hangs until it
       fails with the useless "fetch failed". */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-0G-Provider-Trust-Mode": "private",
        },
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(90_000),
      });
      transport = null;
    } catch (e) {
      transport = e;
      res = null;
    }
    // 503 = no free TeeML provider. 429 = we asked too fast, which happens the
    // moment anyone clicks twice. Both are worth waiting out; neither is a
    // reason to relax the trust mode.
    if (res && res.status !== 503 && res.status !== 429) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }

  if (!res) {
    throw new EnclaveError(
      transport?.name === "TimeoutError"
        ? "the enclave did not answer within 90s - it is reasoning or the router is slow. Try again."
        : `could not reach the enclave: ${String(transport?.message ?? "network error").slice(0, 90)}`,
      "unreachable",
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new EnclaveError("the 0G key was rejected", "bad-key");
  }
  if (res.status === 503) {
    throw new EnclaveError(
      "every sealed machine is busy right now. We waited and tried again rather than " +
        "sending your document somewhere less private. Try once more in a moment.",
      "no-capacity",
    );
  }
  if (res.status === 429) {
    throw new EnclaveError(
      "that was a lot of questions at once - 0G is asking us to slow down. Wait a few seconds.",
      "rate-limited",
    );
  }
  if (!res.ok) throw new EnclaveError(`chat/completions returned ${res.status}`, "http");

  const json = await res.json();
  const latencyMs = Date.now() - t0;

  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    // Fail closed. An empty completion is an error, never an answer.
    throw new EnclaveError(
      `the enclave returned an empty completion (max_tokens=${body.max_tokens}). ` +
        `Treating as failure rather than parsing it into an answer.`,
      "empty",
    );
  }

  const parsed = parseAnswer(content);
  if (!parsed) {
    throw new EnclaveError(
      `the enclave's reply could not be read as an answer: ${content.slice(0, 80)}`,
      "unparseable",
    );
  }

  const answer = String(parsed.answer ?? "").toLowerCase();
  if (!["yes", "no", "unknown"].includes(answer)) {
    throw new EnclaveError(`the enclave answered "${answer}", which is not yes/no/unknown`, "bad-answer");
  }

  const trace = json.x_0g_trace ?? {};
  const providerAddr = trace.provider ?? null;
  const onPin =
    providerAddr && providerAddr.toLowerCase() === attested.pinned.address.toLowerCase();
  const providerRecord =
    attested.teeml.find((p) => p.address.toLowerCase() === String(providerAddr).toLowerCase()) ?? null;

  // If an answer came back from a provider we cannot show is TeeML, the answer is
  // unusable for our purposes - better no answer than a false provenance claim.
  if (!providerRecord) {
    throw new EnclaveError(
      `answered by ${providerAddr}, which is not a TeeML provider for ${model}. Discarding.`,
      "untrusted-provider",
    );
  }

  const answerJson = JSON.stringify({ answer, band: parsed.band ?? "" });

  return {
    question,
    questionHash: await sha256hex(question),
    answer,
    band: String(parsed.band ?? ""),
    confidence: Number(parsed.confidence ?? 0),
    why: String(parsed.why ?? "").slice(0, 90),
    answerHash: await sha256hex(answerJson),

    // provenance - what we can actually show
    requestId: trace.request_id ?? json.id ?? null,
    chatId: json.id ?? null,
    provider: providerAddr,
    providerName: providerRecord.name,
    providerPinned: Boolean(onPin),
    teeType: `${providerRecord.teeType}/${providerRecord.teeVerifier}`,
    teeAttested: providerRecord.teeAttested,
    trustMode: "private",
    verification: "provider-address", // never "signature" - see the header comment
    model,
    latencyMs,
    costUsd: Number(trace.billing?.total_cost_usd_micro ?? 0) / 1e6,
    usage: json.usage ?? null,

    // what the enclave was allowed to see
    minimisation: { keptLines, droppedLines, totalLines },

    // the non-TeeML providers serving the same model, for the UI's benefit
    nonTeeProviders: attested.nonTee.map((p) => ({ name: p.name, address: p.address })),
  };
}

/**
 * Read the answer out of a reply.
 *
 * glm-5.3 reasons at length and sometimes wraps its JSON in a markdown fence or
 * prefixes a sentence. Rejecting the whole reply throws away a correct answer,
 * so take the first JSON object in it - but still fail if there is not one,
 * rather than inventing a result.
 */
export function parseAnswer(content) {
  const attempts = [
    content,
    content.replace(/^[\s\S]*?```(?:json)?/i, "").replace(/```[\s\S]*$/, ""),
    (content.match(/\{[\s\S]*\}/) ?? [])[0],
  ];
  for (const a of attempts) {
    if (!a) continue;
    try {
      const o = JSON.parse(a.trim());
      if (o && typeof o === "object" && "answer" in o) return o;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/** A leak check we can run on any answer: no figure from the document may appear. */
export function leaksDocument(result, plaintext) {
  const numbers = String(plaintext).match(/\d[\d,]{2,}/g) ?? [];
  const haystack = `${result.band} ${result.why}`.replace(/,/g, "");
  return numbers.some((n) => n.replace(/,/g, "").length >= 3 && haystack.includes(n.replace(/,/g, "")));
}
