/**
 * AskOnly — the owner's vault.
 *
 * Everything secret happens in this file, in the page, before anything is sent:
 * the passphrase is read here, the key is derived here, the document is
 * encrypted here. The server receives ciphertext and could not decrypt it if
 * it wanted to.
 */

import { $, api, toast, onTick, describeRemaining, short, renderModeBanner } from "./api.js";
import { encryptDocument } from "./vaultcrypto.js";
import { stampIn, tweenNumber } from "./motion.js";

let SETS = {};
let sealed = null; // the most recently sealed vault
let OWNER = null;

const setStamp = (el, text, kind) => {
  el.textContent = text;
  el.className = `tag tag--${kind}`;
};

/* ------------------------------------------------------------------ boot */

const mode = await renderModeBanner();
if (mode) $("#keyWho").textContent = mode.operatorSeesExtract
  ? "held by this hosted operator — run locally to hold it yourself"
  : "held by your browser, never sent here";

const health = await api("/api/health").catch(() => null);
if (!health?.arkiv?.connected) {
  toast(health?.arkiv?.reason ?? "Arkiv is not reachable", "bad");
} else {
  OWNER = health.arkiv.wallet;
}
if (health?.questionSets) {
  SETS = health.questionSets;
  const sel = $("#questionSet");
  sel.innerHTML = Object.entries(SETS)
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
    .join("");
  syncSet();
}

function syncSet() {
  const key = $("#questionSet").value;
  const set = SETS[key];
  if (!set) return;
  $("#paramLabel").textContent = set.param.name.replace(/^\w/, (c) => c.toUpperCase());
  $("#param").value = set.param.default;
  $("#setHint").textContent = set.param.hint;
  previewQuestion();
}

function previewQuestion() {
  const key = $("#questionSet").value;
  const p = $("#param").value.trim() || SETS[key]?.param.default;
  const text = {
    income: (v) => `Is monthly income above INR ${v}?`,
    identity: (v) => `Does the name on this document match "${v}"?`,
    tenancy: (v) => `Is there an active tenancy with rent paid to date as of ${v}?`,
    employment: (v) => `Has this person been employed for more than ${v} months?`,
  }[key];
  $("#questionPreview").textContent = text ? text(p) : "—";
}

$("#questionSet").addEventListener("change", syncSet);
$("#param").addEventListener("input", previewQuestion);

/* --------------------------------------------------------------- sealing */

$("#sealBtn").addEventListener("click", async () => {
  const btn = $("#sealBtn");
  const out = $("#sealOut");
  const text = $("#docText").value.trim();
  const pass = $("#pass").value;

  if (!text) return toast("there is no document to seal", "bad");
  if (pass.length < 6) return toast("use a passphrase of at least 6 characters", "bad");

  btn.disabled = true;
  setStamp($("#sealState"), "encrypting", "warn");
  out.textContent = "deriving key…";

  try {
    // This is the whole privacy boundary, and it is three lines long.
    const e = await encryptDocument(text, pass);
    out.textContent = `${e.bytesLen} bytes of ciphertext · sha256 ${short(e.sha256, 8, 6)}`;

    setStamp($("#sealState"), "storing", "warn");
    const res = await api("/api/vault", {
      method: "POST",
      body: {
        owner: OWNER,
        label: $("#docLabel").value.trim() || "Untitled",
        docKind: $("#docKind").value,
        sha256: e.sha256,
        iv: e.iv,
        cipher: e.cipherHex,
        days: Number($("#docDays").value || 180),
      },
    });

    sealed = { ...res, label: $("#docLabel").value };
    setStamp($("#sealState"), "sealed", "on");
    stampIn($("#sealState"));
    out.innerHTML = `stored as <strong>${res.vaultId}</strong> · dies at block ${res.expiresAt}`;
    toast(`Sealed. ${res.bytesLen} bytes stored, unreadable without your passphrase.`, "good");
    await loadVaults();
    $("#grantVault").value = res.vaultId;
  } catch (err) {
    setStamp($("#sealState"), "failed", "stop");
    out.textContent = err.message;
    toast(err.message, "bad");
  } finally {
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- grants */

async function loadVaults() {
  try {
    const { vaults } = await api(`/api/vaults${OWNER ? `?owner=${OWNER}` : ""}`);
    const sel = $("#grantVault");
    sel.innerHTML = vaults.length
      ? vaults.map((v) => `<option value="${v.vaultId}">${v.label} — ${v.vaultId} (${v.bytesLen} bytes)</option>`).join("")
      : `<option value="">— seal one first —</option>`;
  } catch (e) {
    toast(e.message, "bad");
  }
}

$("#grantBtn").addEventListener("click", async () => {
  const btn = $("#grantBtn");
  const vaultId = $("#grantVault").value;
  if (!vaultId) return toast("seal a document first", "bad");

  const [unit, n] = $("#life").value.split(":");
  btn.disabled = true;
  setStamp($("#grantState"), "issuing", "warn");

  try {
    const res = await api("/api/grant", {
      method: "POST",
      body: {
        vaultId,
        owner: OWNER,
        verifier: $("#verifier").value.trim(),
        verifierName: $("#verifierName").value.trim(),
        questionSet: $("#questionSet").value,
        usesAllowed: Number($("#uses").value || 3),
        minutes: unit === "m" ? Number(n) : null,
        days: unit === "d" ? Number(n) : null,
        threshold: $("#param").value.trim(),
        note: $("#questionPreview").textContent,
      },
    });
    setStamp($("#grantState"), "issued", "on");
    stampIn($("#grantState"));
    const link = `${location.origin}/ask.html?grant=${res.grantId}`;
    $("#grantOut").innerHTML = `<a href="${link}">${res.grantId}</a> · dies at block ${res.expiresAt}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast("Capability issued. The link is on your clipboard.", "good");
    await loadGrants();
  } catch (e) {
    setStamp($("#grantState"), "failed", "stop");
    $("#grantOut").textContent = e.message;
    toast(e.message, "bad");
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------------------------- the live grant list */

let stopTicking = null;

async function loadGrants() {
  const host = $("#grants");
  try {
    const { grants } = await api(`/api/grants${OWNER ? `?owner=${OWNER}` : ""}`);
    if (!grants.length) {
      host.innerHTML = `<p class="empty">No permissions yet.</p>`;
      return;
    }

    host.innerHTML = grants
      .map((g) => {
        const link = `${location.origin}/ask.html?grant=${g.grantId}`;
        return `
        <article class="grant" data-dies="${g.diesAt}" data-key="${g.entityKey}" data-id="${g.grantId}">
          <div class="grant__top">
            <span class="grant__who">${g.verifierName || short(g.verifier, 8, 4)}</span>
            <span class="tag tag--${g.state === "live" ? "warn" : g.state === "revoked" ? "stop" : "on"}">${g.state}</span>
          </div>
          <p class="grant__q">${g.questionSet}${g.threshold ? ` · ${g.threshold}` : ""} · ${g.usesSpent}/${g.usesAllowed} used</p>
          <div class="grant__clock">
            <span>dies in <span class="grant__blocks" data-blocks>—</span></span>
            <span data-time>—</span>
          </div>
          <div class="meter"><i style="width:100%"></i></div>
          <div class="grant__act">
            <a class="btn btn--ghost btn--sm" href="${link}">Open as verifier</a>
            <button class="btn btn--ghost btn--sm" data-extend>Extend 7d</button>
            <button class="btn btn--ghost btn--sm" data-revoke>Revoke</button>
          </div>
        </article>`;
      })
      .join("");

    wireGrantActions();
    startClocks();
  } catch (e) {
    host.innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

function startClocks() {
  stopTicking?.();
  const cards = [...document.querySelectorAll(".grant")];
  const issued = new Map(cards.map((c) => [c, Number(c.dataset.dies)]));

  const tick = () => {
    for (const card of cards) {
      const r = describeRemaining(issued.get(card));
      const blocks = card.querySelector("[data-blocks]");
      const time = card.querySelector("[data-time]");
      const meter = card.querySelector(".meter");
      const bar = card.querySelector(".meter > i");

      if (r.dead) {
        blocks.textContent = "0 blocks";
        time.textContent = "expired";
        card.classList.add("grant--dead");
        card.classList.remove("grant--dying");
        meter.className = "meter meter--dead";
        bar.style.width = "0%";
        continue;
      }
      if (r.showBlocks) {
        tweenNumber(blocks, r.blocks, { duration: 280, format: (n) => `${Math.round(n)} blocks` });
      } else {
        // six figures of blocks is noise; the duration carries it past a day
        blocks.dataset.n = String(r.blocks);
        blocks.textContent = r.text;
      }
      time.textContent = r.showBlocks ? r.text : `${r.blocks.toLocaleString()} blocks`;
      // The bar is proportional to the last ten minutes of life, so a 7-day
      // grant does not look identical to a 2-minute one for six days.
      const pct = Math.max(0, Math.min(100, (r.ms / (10 * 60 * 1000)) * 100));
      bar.style.width = `${pct}%`;
      if (r.ms < 60_000) {
        card.classList.add("grant--dying");
        meter.className = "meter meter--dying";
      }
    }
  };
  tick();
  stopTicking = onTick(tick);
}

function wireGrantActions() {
  for (const card of document.querySelectorAll(".grant")) {
    card.querySelector("[data-extend]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const r = await api("/api/grant/extend", {
          method: "POST",
          body: { entityKey: card.dataset.key, days: 7 },
        });
        toast(
          `Extended to block ${r.expiresAt}. That extension emitted a public event — ` +
            `this is the act that leaves a trace.`,
          "good",
        );
        await loadGrants();
      } catch (err) {
        toast(err.message, "bad");
        e.target.disabled = false;
      }
    });

    card.querySelector("[data-revoke]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        await api("/api/grant/revoke", { method: "POST", body: { entityKey: card.dataset.key } });
        toast("Revoked.", "good");
        await loadGrants();
      } catch (err) {
        toast(err.message, "bad");
        e.target.disabled = false;
      }
    });
  }
}

$("#refresh").addEventListener("click", () => {
  loadVaults();
  loadGrants();
});

await loadVaults();
await loadGrants();
