/**
 * AskOnly — the landing page's one live moment.
 *
 * The thing being demonstrated is a negative: the document does NOT move. So
 * the animation deliberately gives the document card no transform at any point.
 * What moves is one dot carrying a question, and one bit coming back.
 *
 * Interruptible: pressing ask again mid-flight restarts from the dot's current
 * position rather than snapping it home first.
 */

import { Spring, stampIn, reduceMotion, tweenNumber } from "./motion.js";

const $ = (id) => document.getElementById(id);

const stage = $("stage");
const dot = $("dot");
const docLines = [...$("docLines").querySelectorAll("li")];
const enclave = $("enclave");
const out = $("enclaveOut");
const receipt = $("receipt");
const stageState = $("stageState");
const stageNote = $("stageNote");
const wireQ = $("wireQ");
const askBtn = $("askBtn");
const askBad = $("askBad");

/* The dot's position is a spring so an interrupted run blends instead of
   jumping. 0 = at the document, 1 = at the enclave. */
let travel = new Spring(0, {
  damping: 1,
  response: 0.55,
  onFrame: (v) => {
    const track = dot.parentElement.getBoundingClientRect();
    const span = Math.max(track.width - 10, 0);
    dot.style.transform = `translateX(${v * span}px)`;
    dot.style.opacity = v > 0.01 && v < 0.99 ? "1" : v >= 0.99 ? "0" : "0";
  },
});

let run = 0; // cancels a stale run when a new one starts

const setState = (text, kind) => {
  stageState.textContent = text;
  stageState.className = `stamp stamp--${kind}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? Math.min(ms, 60) : ms));

function resetStage() {
  receipt.hidden = true;
  out.innerHTML = '<span class="mono muted">waiting</span>';
  enclave.classList.remove("is-working");
  docLines.forEach((li) => li.classList.remove("is-sent", "is-held"));
  wireQ.className = "wire__q mono";
  dot.style.opacity = "0";
}

/** Fake-but-faithful request id, shaped exactly like 0G's. The real screens
 *  show the real one; this is the landing page and says "live — press ask". */
const fakeId = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

async function askPermitted() {
  const mine = ++run;
  resetStage();
  setState("authorising", "info");
  stageNote.textContent = "Checking the ENS role before anything touches the document.";
  await sleep(520);
  if (mine !== run) return;

  // minimisation: show which lines are given and which are withheld
  setState("narrowing", "run");
  stageNote.textContent = "Only the lines bearing on income are given to the enclave.";
  for (const li of docLines) {
    li.classList.add(li.dataset.keep === "1" ? "is-sent" : "is-held");
    await sleep(80);
    if (mine !== run) return;
  }

  wireQ.classList.add("is-live");
  setState("in the enclave", "run");
  enclave.classList.add("is-working");
  stageNote.textContent = "Intel TDX. The model runs inside the enclave, not beside it.";
  travel.retarget(1);
  await sleep(900);
  if (mine !== run) return;

  out.innerHTML = '<span class="mono" style="color:#b9b2a6;font-size:11px">reasoning…</span>';
  await sleep(1100);
  if (mine !== run) return;

  // the bit comes back
  travel.set(0);
  out.innerHTML = '<span class="bit">YES</span>';
  enclave.classList.remove("is-working");
  setState("answered", "done");

  $("rQ").textContent = "income > ₹50,000";
  $("rA").textContent = "yes · above threshold";
  $("rSaw").textContent = "2 of 6 lines";
  $("rProv").textContent = "0xD179…E503 · TDX/dstack";
  $("rReq").textContent = fakeId();
  $("rDies").textContent = "—";
  receipt.hidden = false;
  stampIn(receipt.querySelector(".stamp"));
  stageNote.textContent =
    "One bit crossed. The document never moved, and the receipt carries the asker's signature.";

  // the signature detail: a countdown in blocks, not seconds
  let blocks = 45;
  const dies = $("rDies");
  dies.dataset.n = String(blocks);
  const tickDown = setInterval(() => {
    if (mine !== run) return clearInterval(tickDown);
    blocks -= 1;
    tweenNumber(dies, blocks, { duration: 300, format: (n) => `${Math.round(n)} blocks` });
    if (blocks <= 0) {
      clearInterval(tickDown);
      dies.textContent = "expired";
      setState("expired", "block");
      receipt.style.opacity = "0.55";
      stageNote.textContent =
        "The permission died. No extension event was emitted, so nobody kept it alive.";
    }
  }, 1000);
}

async function askRefused() {
  const mine = ++run;
  resetStage();
  wireQ.textContent = "exact salary ?";
  wireQ.classList.add("is-bad");
  setState("authorising", "info");
  stageNote.textContent = "Checking the ENS role for this question set.";
  await sleep(620);
  if (mine !== run) return;

  setState("refused", "block");
  out.innerHTML = '<span class="mono" style="color:#f0a59c;font-size:11px">no role</span>';
  docLines.forEach((li) => li.classList.add("is-held"));
  stageNote.textContent =
    "Refused on-chain. hasRoles said no, so the enclave was never called and the document was never read.";
  const s = document.createElement("span");
  s.className = "stamp stamp--block stamp--cocked";
  s.textContent = "no ens role";
  out.innerHTML = "";
  out.appendChild(s);
  stampIn(s);
  await sleep(200);
  wireQ.textContent = "income > ₹50,000 ?";
}

askBtn.addEventListener("pointerdown", () => askBtn.setAttribute("data-pressed", "1"));
askBtn.addEventListener("click", askPermitted);
askBad.addEventListener("click", askRefused);

/* Run it once on load so the page is never a still image waiting for a click,
   but only when motion is welcome and the stage is actually on screen. */
if (!reduceMotion()) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        io.disconnect();
        setTimeout(askPermitted, 420);
      }
    }
  }, { threshold: 0.4 });
  io.observe(stage);
}

/* Footer: say what the chain actually says, or say it is not wired. */
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    const el = $("footChain");
    if (h?.chain?.connected) {
      el.textContent = `ENSv2 ${h.chain.ensIsLiveRegistry ? "live registry" : "registry"} · sepolia block ${h.chain.block} · arkiv ${h.arkiv?.connected ? `block ${h.arkiv.block}` : "offline"}`;
    } else {
      el.textContent = h?.chain?.reason ?? "chain not wired";
    }
  })
  .catch(() => {
    $("footChain").textContent = "server offline";
  });
