import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Check, ChevronRight, X } from "lucide-react";
import clsx from "clsx";

import { LINES, linesFor } from "./payslip.js";

const EASE = [0.22, 1, 0.36, 1];

/* Asked of the real picker, so this can never disagree with what the app does. */
const READ = linesFor("Can they afford rent of ₹25,000 a month?").size;

/** Calls back every `ms` while its element is on screen and motion is allowed. */
function useCycle(ref, ms, step, enabled = true) {
  const seen = useInView(ref, { amount: 0.4 });
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!seen || reduce || !enabled) return undefined;
    const id = setInterval(step, ms);
    return () => clearInterval(id);
  }, [seen, reduce, enabled, ms]); // eslint-disable-line react-hooks/exhaustive-deps
}

const FOLDERS = [
  ["Payslip", "Can they afford the rent?"],
  ["Lease", "Is the lease still running?"],
  ["Degree", "Did they graduate?"],
  ["Ticket", "Do they have a seat on the flight?"],
];

function FolderDemo() {
  const ref = useRef(null);
  const [on, setOn] = useState(0);
  const [held, setHeld] = useState(false);
  useCycle(ref, 2600, () => setOn((v) => (v + 1) % FOLDERS.length), !held);
  return (
    <div ref={ref}>
      <div className="dm-tabs" role="tablist" aria-label="Kinds of document">
        {FOLDERS.map(([name], i) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={on === i}
            className={clsx(on === i && "is-on")}
            onClick={() => {
              setHeld(true);
              setOn(i);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="dm-page">
        <motion.p
          key={on}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          {FOLDERS[on][1]}
        </motion.p>
        <span className="dm-rules" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

function SealedDemo() {
  const ref = useRef(null);
  const seen = useInView(ref, { amount: 0.5, once: true });
  return (
    <ul ref={ref} className="dm-rows">
      {[
        ["0G · Intel TDX", "Sealed", Check, "is-yes"],
        ["Ordinary server", "Thrown away", X, "is-no"],
      ].map(([name, verdict, Icon, tone], i) => (
        <li key={name}>
          <span>{name}</span>
          <motion.b
            className={tone}
            initial={{ scale: 1.5, opacity: 0, rotate: -9 }}
            animate={seen ? { scale: 1, opacity: 1, rotate: -3 } : {}}
            transition={{ delay: 0.25 + i * 0.5, duration: 0.17, ease: [0.55, 0, 1, 0.45] }}
          >
            <Icon size={14} strokeWidth={3} />
            {verdict}
          </motion.b>
        </li>
      ))}
    </ul>
  );
}

function ReceiptDemo() {
  const ref = useRef(null);
  const seen = useInView(ref, { amount: 0.5, once: true });
  return (
    <div ref={ref} className="dm-slot">
      <motion.dl
        initial={{ y: "-101%" }}
        animate={seen ? { y: 0 } : {}}
        transition={{ duration: 1.1, ease: [0.3, 0.1, 0.2, 1] }}
      >
        <div>
          <dt>Answer</dt>
          <dd>Yes</dd>
        </div>
        <div>
          <dt>Read</dt>
          <dd className="tnum">
            {READ} of {LINES.length} lines
          </dd>
        </div>
        <div>
          <dt>Machine</dt>
          <dd>Intel TDX</dd>
        </div>
      </motion.dl>
    </div>
  );
}

const CARDS = [
  { title: "Any document", body: "Payslips, leases, degrees, tickets. No special format.", tone: "is-paper", Demo: FolderDemo },
  { title: "A sealed machine reads it", body: "Intel TDX on 0G. Answers from ordinary servers are thrown away.", tone: "is-forest", Demo: SealedDemo },
  { title: "A receipt for every answer", body: "Which machine answered, and how much it read.", tone: "is-marker", Demo: ReceiptDemo },
];

/** Three sheets, dealt onto the table. */
export default function Proof() {
  return (
    <section className="lp-proof">
      <div className="lp-wrap">
        <p className="lp-kicker">Nobody has to trust us</p>
        <h2 className="lp-title">
          Built so you never have to
          <br />
          <em>take our word for it.</em>
        </h2>
        <ul className="lp-cards">
          {CARDS.map((c, i) => (
            <motion.li
              key={c.title}
              className={clsx("lp-card", c.tone)}
              initial={{ opacity: 0, y: 48, rotate: (i - 1) * 4 }}
              whileInView={{ opacity: 1, y: 0, rotate: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.7, delay: i * 0.09, ease: EASE }}
            >
              <div className="lp-card-demo">
                <c.Demo />
              </div>
              <h3 className="lp-card-title">{c.title}</h3>
              <p className="lp-card-body">{c.body}</p>
            </motion.li>
          ))}
        </ul>
        <a
          className="lp-read-code"
          href="https://github.com/DanishVahora/eth_global"
          target="_blank"
          rel="noreferrer"
        >
          Read the code <ChevronRight size={17} strokeWidth={2.4} />
        </a>
      </div>
    </section>
  );
}
