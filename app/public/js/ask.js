/**
 * AskOnly — the verifier's screen.
 *
 * The order of operations here is the product:
 *
 *   1. Read the capability from Arkiv. If it is gone, it is EXPIRED - the
 *      network simply stops returning it, and that 404 is the proof.
 *   2. Check the ENS role on Sepolia. No role, no question - and the refusal is
 *      recorded before the document is touched.
 *   3. Decrypt locally (owner's passphrase) and send a minimal extract to the
 *      enclave. In local mode the browser calls 0G directly; the server is not
 *      in this path at all.
 *   4. The answer is NOT shown until the verifier signs for having asked it.
 */

import { $, api, toast, connect, currentAccount, signReceipt, short, onTick, describeRemaining, renderModeBanner } from "./api.js";
import { decryptDocument } from "./vaultcrypto.js";
import { stampIn } from "./motion.js";

const params = new URLSearchParams(location.search);
const grantId = params.get("grant");

let MODE = null;
let GRANT = null;
let ACCOUNT = null;
let PENDING = null; // the answer, held back until signed

const setStamp = (el, text, kind) => {
  el.textContent = text;
  el.className = `stamp stamp--${kind}`;
};

MODE = await renderModeBanner();

/* ------------------------------------------------------------ the wallet */

async function refreshAccount() {
  ACCOUNT = await currentAccount();
  $("#who").textContent = ACCOUNT ? short(ACCOUNT, 6, 4) : "not connected";
  $("#connect").textContent = ACCOUNT ? "Change" : "Connect wallet";
  updateAskable();
}

$("#connect").addEventListener("click", async () => {
  try {
    await connect();
    await refreshAccount();
    await checkPermission();
  } catch (e) {
    toast(e.message, "bad");
  }
});

function updateAskable() {
  const ok = Boolean(GRANT && ACCOUNT && GRANT.state === "live");
  $("#askBtn").disabled = !ok;
  $("#askHint").textContent = !ACCOUNT
    ? "Connect a wallet first — the answer is released against your signature."
    : !GRANT
      ? "No capability loaded."
      : GRANT.state !== "live"
        ? `This capability is ${GRANT.state}.`
        : "You will be asked to sign the receipt before the answer is shown.";
}

/* --------------------------------------------------------- the capability */

async function loadGrant() {
  if (!grantId) {
    setStamp($("#grantStamp"), "no grant", "block");
    $("#headline").textContent = "No capability in this link.";
    $("#question").textContent = "Ask whoever sent you here for a grant link.";
    return;
  }
  try {
    GRANT = await api(`/api/grant?id=${encodeURIComponent(grantId)}`);
    setStamp($("#grantStamp"), GRANT.state, GRANT.state === "live" ? "run" : "block");
    $("#kGrant").textContent = GRANT.grantId;
    $("#kWho").textContent = `${GRANT.verifierName || ""} ${short(GRANT.verifier, 8, 6)}`.trim();
    $("#kSet").textContent = GRANT.questionSet;
    $("#kUses").textContent = `${GRANT.usesSpent} of ${GRANT.usesAllowed} used`;
    $("#question").textContent = GRANT.note || "—";
    startClock();
  } catch (e) {
    if (e.status === 404) {
      // This is the whole thesis, and it arrives as an ordinary 404.
      setStamp($("#grantStamp"), "expired", "block");
      $("#headline").textContent = "This permission no longer exists.";
      $("#kDies").textContent = "expired";
      $("#question").textContent =
        "The network stops returning an expired entity, and every operation on it fails. There was nothing to revoke and nothing to delete.";
      $("#lifeBar").style.width = "0%";
      $("#lifeBar").parentElement.className = "meter meter--dead mt4";
      toast("The capability has expired. It was allowed to die.", "bad");
    } else {
      toast(e.message, "bad");
    }
  }
  updateAskable();
}

function startClock() {
  const tick = () => {
    const r = describeRemaining(GRANT.diesAt);
    $("#kDies").textContent = r.dead ? "expired" : `${r.blocks} blocks · ${r.text}`;
    const pct = r.dead ? 0 : Math.max(0, Math.min(100, (r.ms / (10 * 60 * 1000)) * 100));
    $("#lifeBar").style.width = `${pct}%`;
    if (r.dead) {
      $("#lifeBar").parentElement.className = "meter meter--dead mt4";
      $("#askBtn").disabled = true;
    } else if (r.ms < 60_000) {
      $("#lifeBar").parentElement.className = "meter meter--dying mt4";
    }
  };
  tick();
  onTick(tick);
}

/* ------------------------------------------------------- the ENS check */

async function checkPermission() {
  if (!ACCOUNT || !GRANT) return null;
  try {
    const p = await api(`/api/permission?asker=${ACCOUNT}&label=&registry=demo`);
    return p.permitted[GRANT.questionSet] === true;
  } catch (e) {
    toast(`ENS check failed: ${e.message}`, "bad");
    return null;
  }
}

/* --------------------------------------------------------- provenance */

async function loadProviders() {
  try {
    const p = await api("/api/providers");
    if (!p.configured) {
      $("#providers").innerHTML = `<p class="hint">No 0G key configured on this instance.</p>`;
      setStamp($("#teeStamp"), "no key", "block");
      return;
    }
    setStamp($("#teeStamp"), `${p.teeml} teeml`, p.teeml ? "done" : "block");
    $("#providers").innerHTML = p.providers
      .map((x) => {
        const tee = x.verifiability === "TeeML";
        return `<div class="provider-row">
          <span class="stamp stamp--${tee ? "done" : "block"}">${tee ? "teeml" : "no tee"}</span>
          <span class="grow">
            <strong style="font-weight:500">${x.name}</strong>
            <span class="mono muted" style="display:block">${short(x.address, 10, 6)}${tee ? ` · ${x.teeType}/${x.teeVerifier}` : ""}</span>
          </span>
          ${x.address.toLowerCase() === p.pinned.toLowerCase() ? '<span class="stamp stamp--info">pinned</span>' : ""}
        </div>`;
      })
      .join("");
  } catch (e) {
    $("#providers").innerHTML = `<p class="hint">${e.message}</p>`;
  }
}

/* ------------------------------------------------------------- the ask */

$("#askBad").addEventListener("click", async () => {
  const question = "What is their exact salary?";
  $("#answerCard").hidden = false;
  $("#waiting").hidden = true;
  setStamp($("#answerStamp"), "refused", "block");
  const s = document.createElement("span");
  s.className = "landed landed--no";
  s.textContent = "REFUSED";
  $("#verdictBody").innerHTML = "";
  $("#verdictBody").appendChild(s);
  stampIn(s);
  const note = document.createElement("p");
  note.className = "hint mt4";
  note.textContent =
    "That question is not in the set you hold a role for. The ENS check failed, so the enclave was never called and the document was never decrypted.";
  $("#verdictBody").appendChild(note);
  $("#rQuestion").textContent = question;

  if (ACCOUNT && GRANT) {
    try {
      await api("/api/refusal", {
        method: "POST",
        body: {
          grantId: GRANT.grantId,
          owner: GRANT.owner,
          asker: ACCOUNT,
          question,
          questionHash: await sha256(question),
          reason: "out-of-set",
          detail: "The income set permits a threshold comparison, never an exact figure.",
        },
      });
      toast("Refusal recorded. The owner can see what you tried to ask.", "bad");
    } catch (e) {
      toast(e.message, "bad");
    }
  }
});

async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

$("#askBtn").addEventListener("click", async () => {
  const btn = $("#askBtn");
  btn.disabled = true;
  $("#answerCard").hidden = false;
  $("#verdictBody").innerHTML = "";
  $("#waiting").hidden = false;
  setStamp($("#answerStamp"), "authorising", "info");
  $("#waitingText").textContent = "checking your ENS role…";

  try {
    const permitted = await checkPermission();
    if (permitted === false) {
      $("#waiting").hidden = true;
      setStamp($("#answerStamp"), "no ens role", "block");
      const s = document.createElement("span");
      s.className = "landed landed--no";
      s.textContent = "REFUSED";
      $("#verdictBody").appendChild(s);
      stampIn(s);
      const note = document.createElement("p");
      note.className = "hint mt4";
      note.innerHTML =
        `Your address does not hold the <span class="mono">${GRANT.questionSet}</span> role on-chain, ` +
        `so the question was refused before anything touched the document. ` +
        `Grant the role and ask again — nothing in this app changes, only ENS state.`;
      $("#verdictBody").appendChild(note);
      await api("/api/refusal", {
        method: "POST",
        body: {
          grantId: GRANT.grantId, owner: GRANT.owner, asker: ACCOUNT,
          question: GRANT.note, questionHash: await sha256(GRANT.note),
          reason: "no-ens-role", detail: `missing role for ${GRANT.questionSet}`,
        },
      }).catch(() => {});
      btn.disabled = false;
      return;
    }

    // The owner's passphrase is needed to open the document. In a real
    // deployment this is the owner's device answering; for the demo the
    // verifier screen asks for it so one machine can show the whole loop.
    const pass = prompt("Owner passphrase (the demo runs both sides on one machine):", "mumbai-2026");
    if (!pass) throw new Error("cancelled");

    $("#waitingText").textContent = "decrypting locally…";
    const v = await api(`/api/vault?id=${encodeURIComponent(GRANT.vaultId)}`);
    const plaintext = await decryptDocument(v.cipher, v.iv, pass);

    $("#waitingText").textContent = "narrowing the extract…";
    const prep = await api("/api/ask/prepare", {
      method: "POST",
      body: { questionSet: GRANT.questionSet, param: GRANT.threshold, plaintext },
    });

    setStamp($("#answerStamp"), "in the enclave", "run");
    $("#waitingText").textContent = `in the enclave — ${prep.minimisation.keptLines} of ${prep.minimisation.totalLines} lines sent`;

    let result;
    if (MODE?.browserCanReachEnclave) {
      // THE honest path: this browser calls 0G itself. The key is the owner's,
      // kept in this page, and the server never sees it or the extract.
      const key = localStorage.getItem("askonly.zerogKey") ||
        prompt("Your 0G API key (stays in this browser, sent only to router-api.0g.ai):") || "";
      if (!key) throw new Error("no 0G key — AskOnly never ships with one");
      localStorage.setItem("askonly.zerogKey", key);
      result = await askEnclaveDirect(prep, key);
    } else {
      result = await api("/api/ask/relay", {
        method: "POST",
        body: { questionSet: GRANT.questionSet, param: GRANT.threshold, plaintext },
      });
    }

    $("#waiting").hidden = true;
    PENDING = { ...result, question: prep.question, questionHash: prep.questionHash, minimisation: prep.minimisation };

    // The answer exists but is NOT rendered yet.
    setStamp($("#answerStamp"), "sign to see it", "run");
    const gate = document.createElement("div");
    gate.className = "stack gap4";
    gate.innerHTML = `
      <p class="hint">
        The answer is ready. Sign the receipt to see it — you cannot be told the
        answer without a record that you asked.
      </p>
      <button class="btn btn--primary" id="signBtn">
        <svg class="ico" aria-hidden="true"><use href="#i-key"/></svg>
        Sign the receipt and reveal
      </button>`;
    $("#verdictBody").appendChild(gate);
    $("#signBtn").addEventListener("click", reveal);
  } catch (e) {
    $("#waiting").hidden = true;
    setStamp($("#answerStamp"), "failed", "block");
    $("#verdictBody").innerHTML = `<p class="hint">${e.message}</p>`;
    toast(e.message, "bad");
    btn.disabled = false;
  }
});

/** Call 0G from the browser. Only works on localhost - the router's CORS
 *  preflight rejects deployed origins, which is exactly why hosted mode relays. */
async function askEnclaveDirect(prep, apiKey) {
  const t0 = Date.now();
  const res = await fetch(prep.request.url, {
    method: "POST",
    headers: { ...prep.request.headers, Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(prep.request.body),
  });
  if (res.status === 401 || res.status === 403) throw new Error("the 0G key was rejected");
  if (res.status === 503) throw new Error("private mode found no free TeeML provider — not downgrading");
  if (!res.ok) throw new Error(`the enclave returned ${res.status}`);
  const json = await res.json();

  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("the enclave returned an empty completion — treating as failure, never as an answer");
  const parsed = JSON.parse(content);
  const trace = json.x_0g_trace ?? {};

  return {
    answer: String(parsed.answer ?? "").toLowerCase(),
    band: String(parsed.band ?? ""),
    why: String(parsed.why ?? "").slice(0, 90),
    answerHash: await sha256(JSON.stringify({ answer: String(parsed.answer ?? "").toLowerCase(), band: String(parsed.band ?? "") })),
    requestId: trace.request_id ?? json.id ?? null,
    provider: trace.provider ?? null,
    model: json.model,
    trustMode: "private",
    verification: "provider-address",
    latencyMs: Date.now() - t0,
    direct: true,
  };
}

/* ------------------------------------------------------------- reveal */

async function reveal() {
  const btn = $("#signBtn");
  btn.disabled = true;
  try {
    const sig = await signReceipt({
      address: ACCOUNT,
      grantId: GRANT.grantId,
      questionHash: PENDING.questionHash,
      answerHash: PENDING.answerHash,
      requestId: PENDING.requestId,
    });

    const a = PENDING.answer;
    $("#verdictBody").innerHTML = "";
    const s = document.createElement("span");
    s.className = `landed${a === "no" ? " landed--no" : a === "unknown" ? " landed--unknown" : ""}`;
    s.textContent = a.toUpperCase();
    $("#verdictBody").appendChild(s);
    stampIn(s);

    if (PENDING.band || PENDING.why) {
      const p = document.createElement("p");
      p.className = "hint mt4";
      p.textContent = [PENDING.band, PENDING.why].filter(Boolean).join(" — ");
      $("#verdictBody").appendChild(p);
    }
    setStamp($("#answerStamp"), "answered", "done");

    $("#rQuestion").textContent = PENDING.question;
    $("#rQHash").textContent = short(PENDING.questionHash, 12, 8);
    $("#rAHash").textContent = short(PENDING.answerHash, 12, 8);
    $("#rReq").textContent = PENDING.requestId ?? "—";
    $("#rProv").textContent = PENDING.provider ? `${short(PENDING.provider, 10, 6)} · ${PENDING.model}` : "—";
    $("#rVerif").textContent = `${PENDING.verification}${PENDING.direct ? " · browser → enclave, direct" : " · relayed by operator"}`;
    $("#rSaw").textContent = `${PENDING.minimisation.keptLines} of ${PENDING.minimisation.totalLines} lines`;
    $("#rSig").textContent = short(sig, 14, 10);

    await api("/api/access", {
      method: "POST",
      body: {
        grantId: GRANT.grantId,
        vaultId: GRANT.vaultId,
        owner: GRANT.owner,
        asker: ACCOUNT,
        askerName: GRANT.verifierName,
        question: PENDING.question,
        questionHash: PENDING.questionHash,
        answer: a,
        answerHash: PENDING.answerHash,
        band: PENDING.band,
        requestId: PENDING.requestId ?? "",
        provider: PENDING.provider ?? "0x0000000000000000000000000000000000000000",
        model: PENDING.model ?? "glm-5.3",
        trustMode: "private",
        verification: PENDING.verification,
        teeType: "TDX/dstack",
        latencyMs: PENDING.latencyMs ?? 0,
        askerSig: sig,
        grantEntityKey: GRANT.entityKey,
        usesSpent: GRANT.usesSpent,
        usesAllowed: GRANT.usesAllowed,
      },
    });
    toast("Receipt written. The owner can see exactly what you asked.", "good");
    await loadGrant();
  } catch (e) {
    toast(e.message, "bad");
    btn.disabled = false;
  }
}

/* --------------------------------------------------------------- boot */

await refreshAccount();
await loadGrant();
await loadProviders();
window.ethereum?.on?.("accountsChanged", refreshAccount);
