/**
 * AskOnly — shared browser helpers: API calls, wallet, the death-block clock.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ wallet */

export const hasWallet = () => typeof window.ethereum !== "undefined";

export async function connect() {
  if (!hasWallet()) throw new Error("no browser wallet found - install one to sign as the verifier");
  const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
  return address;
}

export async function currentAccount() {
  if (!hasWallet()) return null;
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  return accounts?.[0] ?? null;
}

/**
 * The verifier signs what they asked and what they were told, BEFORE the answer
 * is shown to them. 0G does not sign the answer, so this signature is the part
 * of the receipt that is actually cryptographic: it makes the asker unable to
 * deny the question or the reply. That non-repudiation of the asker is the
 * record a consent manager is required to keep.
 */
export async function signReceipt({ address, grantId, questionHash, answerHash, requestId, chainId = 11155111 }) {
  const domain = { name: "AskOnly", version: "1", chainId };
  const types = {
    Receipt: [
      { name: "grantId", type: "string" },
      { name: "questionHash", type: "string" },
      { name: "answerHash", type: "string" },
      { name: "requestId", type: "string" },
      { name: "acknowledgement", type: "string" },
    ],
  };
  const message = {
    grantId,
    questionHash,
    answerHash,
    requestId: requestId ?? "",
    acknowledgement: "I asked this question and was given this answer.",
  };
  return window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [address, JSON.stringify({ domain, types, primaryType: "Receipt", message })],
  });
}

/* ------------------------------------------------------- the death clock */

export const short = (s, head = 6, tail = 4) =>
  !s ? "—" : String(s).length <= head + tail + 1 ? String(s) : `${String(s).slice(0, head)}…${String(s).slice(-tail)}`;

/** Rabdi makes a block every ~2 seconds, so a remaining-time estimate in blocks
 *  is honest in the unit the network actually enforces in. */
export const BLOCK_MS = 2000;

export function describeRemaining(diesAtMs) {
  const ms = diesAtMs - Date.now();
  if (ms <= 0) return { dead: true, blocks: 0, text: "expired", pct: 0 };
  const blocks = Math.max(0, Math.round(ms / BLOCK_MS));
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const text =
    mins >= 60
      ? `${Math.floor(mins / 60)}h ${mins % 60}m`
      : mins >= 1
        ? `${mins}m ${String(secs).padStart(2, "0")}s`
        : `${secs}s`;
  return { dead: false, blocks, text, ms };
}

/** One shared ticker so twenty countdowns do not mean twenty timers. */
const ticking = new Set();
let timer = null;
export function onTick(fn) {
  ticking.add(fn);
  if (!timer) timer = setInterval(() => ticking.forEach((f) => f()), 1000);
  return () => {
    ticking.delete(fn);
    if (!ticking.size) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/* ------------------------------------------------------------------- misc */

export function toast(message, kind = "info") {
  let host = $("#toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-in"));
  setTimeout(() => {
    el.classList.remove("is-in");
    setTimeout(() => el.remove(), 260);
  }, 5200);
}

/** Render the hosted-instance honesty banner when the operator can see extracts. */
export async function renderModeBanner(mountSelector = "#modeBanner") {
  const mount = $(mountSelector);
  if (!mount) return null;
  try {
    const mode = await api("/api/mode");
    if (mode.operatorSeesExtract) {
      mount.innerHTML = `
        <div class="banner">
          <div>
            <strong>This hosted copy is a trusted operator.</strong>
            0G's gateway only accepts browser calls from localhost, so this instance
            relays your question with its own key — which means whoever runs it can
            see the extract. Run AskOnly on your own machine and nobody can.
            <code class="mono">npm start</code>
          </div>
        </div>`;
    } else {
      mount.innerHTML = `
        <div class="banner banner--seal">
          <div>
            <strong>Local mode.</strong>
            Your browser decrypts the document and calls the enclave directly with
            your own key. This server takes no part in answering — there is no middle.
          </div>
        </div>`;
    }
    return mode;
  } catch {
    return null;
  }
}
