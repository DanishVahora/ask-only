import { useLayoutEffect, useMemo, useRef } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import clsx from "clsx";

import { WaxSeal } from "../Paper.jsx";
import { LINES, cipherOf, linesFor } from "./payslip.js";

const QUESTION = "Can they afford rent of ₹25,000 a month?";
const KEEP = linesFor(QUESTION);
const KEPT = KEEP.size;
const TOTAL = LINES.length;

const STEPS = [
  {
    title: <>Seal it.</>,
    body: "Encrypted in your browser, with its own expiry date.",
    from: 0,
    to: 0.25,
  },
  {
    title: <>Add a reviewer.</>,
    body: "Their wallet and a time limit. One signature, and you’re done.",
    from: 0.25,
    to: 0.5,
  },
  {
    title: (
      <>
        They ask.
        <br />
        <em>Your browser answers.</em>
      </>
    ),
    body: "It shows a sealed machine only the lines that matter. One word goes back.",
    from: 0.5,
    to: 0.76,
  },
  {
    title: (
      <>
        Then let it <em>run out.</em>
      </>
    ),
    body: "The permission stops working on its own. Nothing to delete.",
    from: 0.76,
    to: 1,
  },
];

const LIVES = ["2 minutes", "An hour", "A day", "A week"];

const CREAM = "#f4f2e9";
const FOREST = "#123a2c";
const NIGHT = "#141512";
const INK = "#1b1a16";
const ON_DARK = "#f4f3dc";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const seg = (v, a, b) => clamp01((v - a) / (b - a));
const smooth = (t) => t * t * (3 - 2 * t);

const statusAt = (v) =>
  v < 0.06 ? `Sample · ${TOTAL} lines`
  : v < 0.2 ? "Encrypting"
  : v < 0.53 ? "Sealed"
  : v < 0.585 ? "Your browser opens it"
  : v < 0.625 ? `${TOTAL - KEPT} lines withheld`
  : v < 0.695 ? `Reading ${KEPT} of ${TOTAL} lines`
  : v < 0.905 ? "One word sent"
  : "Sealed. Nobody can ask";

const two = (n) => String(n).padStart(2, "0");

/* Nothing until it's signed. Then a whole day runs down as you scroll through step four. */
const clockAt = (v) => {
  if (v < 0.44) return "Not signed yet";
  const left = Math.ceil((1 - seg(v, 0.76, 0.895)) * 86400);
  if (left <= 0) return "Ended";
  return `Ends in ${two(Math.floor(left / 3600))}:${two(Math.floor(left / 60) % 60)}:${two(left % 60)}`;
};

/* Every line of the sheet, built once. The sheet itself never gets a transform. */
function Sheet({ children }) {
  return (
    <div className="pp">
      <div className="pp-head">
        <p className="pp-title">October payslip</p>
        <p className="pp-status" data-status>{`Sample · ${TOTAL} lines`}</p>
      </div>
      <ol className="pp-lines">
        {LINES.map((t, i) => (
          <li key={t} className="pp-line" data-line={i}>
            <span className="pp-text">
              <i className="pp-mark" />
              <b>{t}</b>
              <i className="pp-bar" />
            </span>
          </li>
        ))}
      </ol>
      {children}
    </div>
  );
}

function Scrubbed() {
  const section = useRef(null);
  const stage = useRef(null);
  const nodes = useRef(null);
  const { scrollYProgress: p } = useScroll({ target: section, offset: ["start start", "end end"] });

  const ground = useTransform(p, [0, 0.47, 0.53, 0.78, 0.92, 1], [CREAM, CREAM, FOREST, FOREST, NIGHT, NIGHT]);
  const ink = useTransform(p, [0, 0.47, 0.53, 1], [INK, INK, ON_DARK, ON_DARK]);

  const lines = useMemo(
    () => LINES.map((plain, i) => ({ plain, cipher: cipherOf(plain), keep: KEEP.has(i), n: 0 })),
    [],
  );

  /* One function paints the whole stage from one number, and nothing re-renders. Scroll
     back up and all of it plays backwards. */
  const paint = (v) => {
    const e = nodes.current;
    if (!e) return;

    STEPS.forEach((s, i) => {
      const inn = i === 0 ? 1 : seg(v, s.from, s.from + 0.035);
      const out = i === STEPS.length - 1 ? 0 : seg(v, s.to - 0.035, s.to);
      const o = inn * (1 - out);
      const el = e.copy[i];
      el.style.opacity = o;
      el.style.transform = `translateY(${(1 - inn) * 28 - out * 28}px)`;
      el.style.visibility = o < 0.01 ? "hidden" : "visible";
    });
    e.fill.style.transform = `scaleX(${v})`;
    const on = STEPS.findIndex((s) => v < s.to);
    const step = String(on < 0 ? STEPS.length : on + 1);
    if (e.count.textContent !== step) e.count.textContent = step;

    const status = statusAt(v);
    if (e.status.textContent !== status) e.status.textContent = status;

    lines.forEach((l, i) => {
      const seal = seg(v, 0.06 + i * 0.006, 0.11 + i * 0.006);
      const open = seg(v, 0.53 + i * 0.003, 0.56 + i * 0.003);
      const close = seg(v, 0.905 + i * 0.002, 0.935 + i * 0.002);
      const n = Math.floor(clamp01(seal - open + close) * l.plain.length);
      if (n !== l.n) {
        l.n = n;
        e.text[i].textContent = l.cipher.slice(0, n) + l.plain.slice(n);
      }
      const gone = 1 - seg(v, 0.885, 0.905);
      e.bar[i].style.transform = `scaleX(${l.keep ? 0 : seg(v, 0.585 + i * 0.0025, 0.605 + i * 0.0025) * gone})`;
      e.mark[i].style.transform = `scaleX(${l.keep ? seg(v, 0.625 + (i - 7) * 0.003, 0.645 + (i - 7) * 0.003) * gone : 0})`;
    });

    // The wax comes down when it's sealed, breaks while your browser reads, and returns.
    const waxIn = seg(v, 0.17, 0.2) * (1 - seg(v, 0.515, 0.535));
    const waxBack = seg(v, 0.925, 0.95);
    const wax = Math.max(waxIn, waxBack);
    const press = v > 0.6 ? waxBack : seg(v, 0.17, 0.2);
    e.wax.style.opacity = wax;
    e.wax.style.transform = `scale(${1.7 - 0.7 * press})`;

    // The ticket slides out from under the sheet, and tears off when the time is up.
    const out = smooth(seg(v, 0.27, 0.36));
    const tear = seg(v, 0.895, 0.965);
    e.ticket.style.transform = `translateY(${(out - 1) * 100}%) translateY(${tear * tear * 170}px) rotate(${tear * 7}deg)`;
    e.ticket.style.opacity = 1 - seg(v, 0.93, 0.965);
    e.life.style.transform = `translateX(${smooth(seg(v, 0.37, 0.43)) * 200}%)`;
    e.signed.style.opacity = seg(v, 0.44, 0.46);
    e.burn.style.transform = `scaleX(${seg(v, 0.76, 0.895)})`;
    const clock = clockAt(v);
    if (e.clock.textContent !== clock) e.clock.textContent = clock;

    // A question travels in. It's the one thing here that arrives from outside.
    const q = smooth(seg(v, 0.5, 0.555));
    e.q.style.opacity = q * (1 - seg(v, 0.73, 0.755));
    e.q.style.transform = `translateX(${(1 - q) * 110}px)`;

    const hit = seg(v, 0.665, 0.68);
    e.stamp.style.opacity = hit * (1 - seg(v, 0.885, 0.905));
    e.stamp.style.transform = `scale(${1.7 - 0.7 * hit}) rotate(${-15 + 7 * hit}deg)`;

    // One word leaves. Nothing else on this page ever does.
    const fly = smooth(seg(v, 0.695, 0.75));
    e.reply.style.opacity = seg(v, 0.69, 0.7) * (1 - seg(v, 0.73, 0.75));
    e.reply.style.transform = `translate(${fly * 340}px, ${fly * -70}px)`;

    const end = seg(v, 0.965, 0.98);
    e.end.style.opacity = end;
    e.end.style.transform = `scale(${1.6 - 0.6 * end}) rotate(${-13 + 7 * end}deg)`;
  };

  useLayoutEffect(() => {
    const root = stage.current;
    const pick = (s) => root.querySelector(s);
    nodes.current = {
      copy: [...root.querySelectorAll("[data-copy]")],
      fill: pick("[data-fill]"),
      count: pick("[data-count]"),
      status: pick("[data-status]"),
      text: lines.map((_, i) => pick(`[data-line="${i}"] b`)),
      bar: lines.map((_, i) => pick(`[data-line="${i}"] .pp-bar`)),
      mark: lines.map((_, i) => pick(`[data-line="${i}"] .pp-mark`)),
      wax: pick("[data-wax]"),
      ticket: pick("[data-ticket]"),
      life: pick("[data-life]"),
      signed: pick("[data-signed]"),
      burn: pick("[data-burn]"),
      clock: pick("[data-clock]"),
      q: pick("[data-q]"),
      stamp: pick("[data-stamp]"),
      reply: pick("[data-reply]"),
      end: pick("[data-end]"),
    };
    paint(p.get());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useMotionValueEvent(p, "change", paint);

  return (
    <section id="how" ref={section} className="st">
      <motion.div ref={stage} className="st-stage" style={{ background: ground, color: ink }}>
        <div className="st-copy">
          <p className="lp-kicker">
            How it works / <span data-count>1</span> of {STEPS.length}
          </p>
          <div className="st-rail" aria-hidden="true">
            <i data-fill />
          </div>
          <div className="st-copies">
            {STEPS.map((s, i) => (
              <div key={i} data-copy className="st-step">
                <h2 className="lp-title">{s.title}</h2>
                <p className="lp-lede">{s.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="st-paper">
          <div className="st-q" data-q>
            <small>Your landlord asks</small>
            {QUESTION}
          </div>
          <div className="st-sheet">
            <Sheet>
              <div className="st-wax" data-wax>
                <WaxSeal className="h-full w-full" />
              </div>
              <div className="pp-stamp is-yes" data-stamp>
                Yes
                <small>Comfortably above</small>
              </div>
              <div className="pp-stamp is-no st-end" data-end>
                Nothing to delete
              </div>
            </Sheet>
            <div className="st-reply" data-reply>
              Yes
            </div>
          </div>
          <div className="st-ticket" data-ticket>
            <div className="st-tear" aria-hidden="true">
              <i data-burn />
            </div>
            <div className="st-ticket-top">
              <span>
                <b>Landlord</b> 0x71C7…976F
              </span>
              <span className="tnum" data-clock>
                Not signed yet
              </span>
            </div>
            <div className="st-lives">
              <i data-life />
              {LIVES.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
            <p className="st-signed" data-signed>
              Signed once. That’s the only decision you make.
            </p>
          </div>
        </div>
        <div className="st-edge" aria-hidden="true" />
      </motion.div>
    </section>
  );
}

/** With reduced motion: the same four steps, and the sheet as it looks at the answer. */
function Still() {
  return (
    <section id="how" className="st-still">
      <div className="lp-wrap st-still-in">
        <div>
          <p className="lp-kicker">How it works</p>
          <ol className="st-still-steps">
            {STEPS.map((s, i) => (
              <li key={i}>
                <h2 className="lp-title">{s.title}</h2>
                <p className="lp-lede">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="pp">
          <div className="pp-head">
            <p className="pp-title">October payslip</p>
            <p className="pp-status">{`Read ${KEPT} of ${TOTAL} lines`}</p>
          </div>
          <ol className="pp-lines">
            {LINES.map((t, i) => (
              <li key={t} className={clsx("pp-line", KEEP.has(i) ? "is-read" : "is-held")} style={{ "--i": 0 }}>
                <span className="pp-text">
                  <i className="pp-mark" />
                  <b>{t}</b>
                  <i className="pp-bar" />
                </span>
              </li>
            ))}
          </ol>
          <div className="pp-stamp is-yes">
            Yes
            <small>Comfortably above</small>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Story() {
  return useReducedMotion() ? <Still /> : <Scrubbed />;
}
