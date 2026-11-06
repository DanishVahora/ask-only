import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useReducedMotion } from "motion/react";
import { ArrowUp, Lock } from "lucide-react";
import clsx from "clsx";

import { LINES, linesFor, readFor } from "./payslip.js";

/*
 * Answers that are true of the sample payslip. The lines come from the real picker on
 * every run. Only these words are written here, because a real word would need a real
 * enclave call, so a question somebody types gets the real lines and no made-up word.
 */
const ASKED = [
  { label: "Afford the rent?", q: "Can they afford rent of ₹25,000 a month?", word: "Yes", note: "Comfortably above", tone: "yes" },
  { label: "What’s their PAN?", q: "What is their PAN number?", word: "Unknown", note: "A value never comes back", tone: "unknown" },
  { label: "Earn over ₹2 lakh?", q: "Do they earn over ₹2 lakh a month?", word: "No", note: "Well below", tone: "no" },
];

const TOTAL = LINES.length;
const INK_MS = TOTAL * 26 + 320; // the last bar finishes
const READ_MS = 1150; // the marker runs over what's left
const HOLD_MS = 3400;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ticks down in real seconds: every permission here is on a clock. */
function Clock() {
  const reduce = useReducedMotion();
  const [left, setLeft] = useState(86399);
  useEffect(() => {
    if (reduce) return undefined;
    const id = setInterval(() => setLeft((v) => (v > 0 ? v - 1 : 86399)), 1000);
    return () => clearInterval(id);
  }, [reduce]);
  const two = (n) => String(n).padStart(2, "0");
  return (
    <span className="tnum">
      Ends in {two(Math.floor(left / 3600))}:{two(Math.floor(left / 60) % 60)}:{two(left % 60)}
    </span>
  );
}

function Demo() {
  const reduce = useReducedMotion();
  const box = useRef(null);
  const seen = useInView(box, { amount: 0.3 });
  const seenRef = useRef(seen);
  seenRef.current = seen;

  const [draft, setDraft] = useState(reduce ? ASKED[0].q : "");
  const [run, setRun] = useState(() => (reduce ? { ...ASKED[0], keep: linesFor(ASKED[0].q) } : null));
  const [stage, setStage] = useState(reduce ? 3 : 0); // 0 nothing, 1 withheld, 2 reading, 3 done
  const [auto, setAuto] = useState(!reduce);

  useEffect(() => {
    if (!run) {
      setStage(0);
      return undefined;
    }
    if (reduce) {
      setStage(3);
      return undefined;
    }
    setStage(1);
    const a = setTimeout(() => setStage(2), INK_MS);
    const b = setTimeout(() => setStage(3), INK_MS + READ_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [run, reduce]);

  // Plays by itself until somebody touches it, and only while it's on screen.
  useEffect(() => {
    if (!auto) return undefined;
    let dead = false;
    (async () => {
      await wait(700);
      for (let n = 0; !dead; n += 1) {
        while (!seenRef.current && !dead) await wait(300);
        const a = ASKED[n % ASKED.length];
        for (let i = 1; i <= a.q.length && !dead; i += 1) {
          setDraft(a.q.slice(0, i));
          await wait(24);
        }
        await wait(280);
        if (dead) return;
        setRun({ ...a, keep: linesFor(a.q) });
        await wait(INK_MS + READ_MS + HOLD_MS);
        if (dead) return;
        setRun(null);
        await wait(380);
        if (dead) return;
        setDraft("");
        await wait(420);
      }
    })();
    return () => {
      dead = true;
    };
  }, [auto]);

  const ask = (a) => {
    setAuto(false);
    setDraft(a.q);
    setRun({ ...a, keep: linesFor(a.q) });
  };

  const submit = (e) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    setAuto(false);
    setRun({ q, keep: linesFor(q) });
  };

  const count = run?.keep.size ?? 0;
  // What the enclave is actually given for each line it reads, identifiers masked.
  const shown = useMemo(() => (run ? readFor(run.q) : null), [run]);
  const status = !run
    ? `Sample · ${TOTAL} lines`
    : stage === 1
      ? count === TOTAL
        ? "Nothing narrow to try"
        : `${TOTAL - count} lines withheld`
      : stage === 2
        ? `Reading ${count} of ${TOTAL} lines`
        : run.word
          ? "One word sent"
          : `${count} of ${TOTAL} lines picked`;

  return (
    <div className="pp-wrap" ref={box}>
      <div className="pp">
        <div className="pp-head">
          <p className="pp-title">October payslip</p>
          <p className="pp-status" aria-live={auto ? "off" : "polite"}>
            {status}
          </p>
        </div>
        <ol className="pp-lines">
          {LINES.map((t, i) => (
            <li
              key={t}
              style={{ "--i": i }}
              className={clsx(
                "pp-line",
                run && stage >= 1 && !run.keep.has(i) && "is-held",
                run && stage >= 2 && run.keep.has(i) && "is-read",
              )}
            >
              <span className="pp-text">
                <i className="pp-mark" />
                <b>{run && stage >= 1 && run.keep.has(i) ? (shown?.get(i) ?? t) : t}</b>
                <i className="pp-bar" />
              </span>
            </li>
          ))}
        </ol>
        {run?.word && stage === 3 && (
          <motion.div
            key={run.q}
            className={clsx("pp-stamp", `is-${run.tone}`)}
            initial={reduce ? false : { scale: 1.7, opacity: 0, rotate: -15 }}
            animate={{ scale: 1, opacity: 1, rotate: -8 }}
            transition={{ duration: 0.17, ease: [0.55, 0, 1, 0.45] }}
          >
            {run.word}
            <small>{run.note}</small>
          </motion.div>
        )}
      </div>

      <div className="perf" aria-hidden="true" />

      <form className="pp-ticket" onSubmit={submit}>
        <div className="pp-ticket-top">
          <span>Your landlord asks</span>
          <Clock />
        </div>
        <div className="pp-ask">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (run) setRun(null);
            }}
            onFocus={() => setAuto(false)}
            placeholder="Ask anything about this payslip"
            aria-label="Ask a question about this sample payslip"
            maxLength={120}
          />
          <button type="submit" aria-label="Ask" disabled={!draft.trim()}>
            <ArrowUp size={18} strokeWidth={2.4} />
          </button>
        </div>
        {run && !run.word && stage === 3 ? (
          <p className="pp-free">
            Picked just now, in this page. <Link to="/documents">Seal a document</Link> for the real word.
          </p>
        ) : (
          <div className="pp-chips">
            {ASKED.map((a) => (
              <button key={a.label} type="button" onClick={() => ask(a)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="lp-hero">
      <div className="lp-hero-copy">
        <p className="lp-kicker">AskOnly / answers, not copies</p>
        <h1 className="lp-display">
          Answer the question.
          <br />
          <em>Never send the file.</em>
        </h1>
        <p className="lp-lede">
          Your landlord needs one word, not your payslip, PAN and bank account.
        </p>
        <Link className="lp-btn" to="/documents">
          <Lock size={18} strokeWidth={2.2} />
          Seal a document
        </Link>
        <p className="lp-note">Sealed in your browser. Our server never sees the document.</p>
      </div>
      <Demo />
    </section>
  );
}
