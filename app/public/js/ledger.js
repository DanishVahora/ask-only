/**
 * AskOnly — the owner's ledger.
 *
 * "Who asked about me" is the question the whole product exists to answer, so
 * it is the page's first heading rather than a settings sub-tab.
 */

import { $, api, short, toast } from "./api.js";

const when = (ms) => {
  const d = new Date(ms);
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

async function loadLedger() {
  try {
    const { accesses, refusals } = await api("/api/accesses");

    $("#nAnswered").textContent = String(accesses.length);
    $("#nAnswered").className = `stamp stamp--${accesses.length ? "done" : "todo"}`;
    $("#answered").innerHTML = accesses.length
      ? accesses
          .map(
            (a) => `
      <article class="entry">
        <span class="entry__when">${when(a.at)}</span>
        <div>
          <p class="entry__q">${a.askerName || short(a.asker, 8, 4)} asked “${a.question}”</p>
          <p class="entry__meta">
            req ${a.requestId ? short(a.requestId, 8, 4) : "—"} ·
            ${a.provider ? short(a.provider, 8, 6) : "—"} ·
            ${a.teeType || "—"} · ${a.verification} · ${a.latencyMs}ms
          </p>
          <p class="entry__meta">q ${short(a.questionHash, 10, 6)} · a ${short(a.answerHash, 10, 6)}</p>
        </div>
        <span class="stamp stamp--${a.answer === "yes" ? "done" : a.answer === "no" ? "block" : "todo"}">${a.answer}${a.band ? ` · ${a.band}` : ""}</span>
      </article>`,
          )
          .join("")
      : `<p class="empty">Nothing yet.</p>`;

    $("#nRefused").textContent = String(refusals.length);
    $("#nRefused").className = `stamp stamp--${refusals.length ? "block" : "todo"}`;
    $("#refused").innerHTML = refusals.length
      ? refusals
          .map(
            (r) => `
      <article class="entry">
        <span class="entry__when">${when(r.at)}</span>
        <div>
          <p class="entry__q">${short(r.asker, 8, 4)} tried to ask “${r.question}”</p>
          <p class="entry__meta">${r.detail || ""}</p>
        </div>
        <span class="stamp stamp--block">${r.reason}</span>
      </article>`,
          )
          .join("")
      : `<p class="empty">Nothing refused.</p>`;
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function loadRetention() {
  try {
    const r = await api("/api/retention");
    $("#watchStamp").textContent = r.watching ? "watching" : "not watching";
    $("#watchStamp").className = `stamp stamp--${r.watching ? "run" : "block"}`;
    $("#wSeen").textContent = `${r.seen} chain-wide`;
    $("#wKept").textContent = `${r.kept}`;
    $("#wDropped").textContent = `${r.dropped} strangers'`;

    $("#extensions").innerHTML = r.extensions.length
      ? r.extensions
          .map(
            (e) => `
      <article class="entry">
        <span class="entry__when">${when(e.at)}</span>
        <div>
          <p class="entry__q">A permission of yours was extended</p>
          <p class="entry__meta">entity ${short(e.entityKey, 10, 8)} · new death block ${e.newExpiryBlock}</p>
          <p class="entry__meta">tx ${short(e.txHash, 10, 8)}</p>
        </div>
        <span class="stamp stamp--run">extended</span>
      </article>`,
          )
          .join("")
      : `<p class="empty">${r.statement}</p>`;
  } catch (e) {
    $("#extensions").innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

async function refresh() {
  await Promise.all([loadLedger(), loadRetention()]);
}

$("#refresh").addEventListener("click", refresh);
await refresh();
// The retention counters move on their own as the chain does, so poll them
// rather than making the page look frozen.
setInterval(loadRetention, 6000);
