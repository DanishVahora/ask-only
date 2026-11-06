/**
 * AskOnly — the landing page's one live moment.
 *
 * What is being demonstrated is a negative: the document does NOT move. So the
 * document card is never given a transform at any point. What moves is one dot
 * carrying a question, and one bit coming back.
 *
 * Interruptible: pressing ask again mid-flight restarts from the dot's current
 * position rather than snapping it home first.
 */

import { Spring, stampIn, reduceMotion, tweenNumber } from "./motion.js";

const $ = (id) => document.getElementById(id);

const stage = $("stage");
const dot = $("dot");
const docTag = $("docTag");
const docLines = [...$("docLines").querySelectorAll("li")];
const enclave = $("enclave");
const out = $("enclaveOut");
const note = $("stageNote");
const wireQ = $("wireQ");
const askBtn = $("askBtn");
const askBad = $("askBad");

const travel = new Spring(0, {
  damping: 1,
  response: 0.55,
  onFrame: (v) => {
    const track = dot.parentElement.getBoundingClientRect();
    const span = Math.max(track.width - 10, 0);
    dot.style.transform = `translateX(${v * span}px)`;
    dot.style.opacity = v > 0.02 && v < 0.98 ? "1" : "0";
  },
});

let run = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? Math.min(ms, 50) : ms));

const setTag = (text, cls = "") => {
  docTag.textContent = text;
  docTag.className = `tag ${cls}`.trim();
};

function reset() {
  out.innerHTML = '<span class="mono enclave__idle">waiting</span>';
  enclave.classList.remove("is-working");
  docLines.forEach((li) => li.classList.remove("is-sent", "is-held"));
  wireQ.className = "wire__q mono";
  wireQ.textContent = "income > ₹50,000 ?";
  dot.style.opacity = "0";
  setTag("encrypted · stays here");
}

async function askPermitted() {
  const mine = ++run;
  reset();
  note.textContent = "Checking the on-chain role before anything touches the document.";
  await sleep(500);
  if (mine !== run) return;

  note.textContent = "Only the lines bearing on income are given to the enclave.";
  setTag("narrowing", "tag--on");
  for (const li of docLines) {
    li.classList.add(li.dataset.keep === "1" ? "is-sent" : "is-held");
    await sleep(90);
    if (mine !== run) return;
  }

  wireQ.classList.add("is-live");
  enclave.classList.add("is-working");
  note.textContent = "Intel TDX. The model runs inside the enclave, not beside it.";
  travel.retarget(1);
  await sleep(850);
  if (mine !== run) return;

  out.innerHTML = '<span class="mono enclave__idle">reasoning…</span>';
  await sleep(1000);
  if (mine !== run) return;

  travel.set(0);
  enclave.classList.remove("is-working");
  const bit = document.createElement("span");
  bit.className = "bit";
  bit.textContent = "YES";
  out.innerHTML = "";
  out.appendChild(bit);
  setTag("never left this card", "tag--on");
  note.textContent =
    "One bit crossed. The document never moved, and two of its six lines were all the enclave saw.";
}

async function askRefused() {
  const mine = ++run;
  reset();
  wireQ.textContent = "exact salary ?";
  wireQ.classList.add("is-bad");
  note.textContent = "Checking the on-chain role for this question.";
  await sleep(600);
  if (mine !== run) return;

  docLines.forEach((li) => li.classList.add("is-held"));
  setTag("not opened", "tag--stop");
  const no = document.createElement("span");
  no.className = "bit bit--no";
  no.textContent = "NO";
  out.innerHTML = "";
  out.appendChild(no);
  stampIn(no);
  note.textContent =
    "Refused on-chain. The role check failed, so the enclave was never called and the document was never decrypted.";
}

askBtn.addEventListener("click", askPermitted);
askBad.addEventListener("click", askRefused);

/* Play once when the stage comes into view, so the page is never a still image
   waiting for a click. Nothing is hidden before that - the content is all there. */
if (!reduceMotion()) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          io.disconnect();
          setTimeout(askPermitted, 300);
        }
      }
    },
    { threshold: 0.35 },
  );
  io.observe(stage);

  // count the headline number up once it is on screen
  const big = $("bigNum");
  if (big) {
    big.dataset.n = "0";
    const io2 = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            io2.disconnect();
            tweenNumber(big, 4, { duration: 700 });
          }
        }
      },
      { threshold: 0.6 },
    );
    io2.observe(big);
  }
}

/* The footer says what the chain actually says, or says it is not wired. */
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    const el = $("footChain");
    if (h?.chain?.connected) {
      el.textContent = `ENSv2 ${h.chain.ensIsLiveRegistry ? "live registry" : "registry"} · sepolia ${h.chain.block} · arkiv ${h.arkiv?.connected ? h.arkiv.block : "offline"}`;
    } else {
      el.textContent = h?.chain?.reason ?? "chain not wired";
    }
  })
  .catch(() => {
    $("footChain").textContent = "server offline";
  });
