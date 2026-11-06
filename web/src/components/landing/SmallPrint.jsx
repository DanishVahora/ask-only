import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

const LIMITS = [
  ["We can’t answer while your browser is closed.", "Questions wait. A background tab is enough."],
  ["Sometimes the enclave reads the whole document.", "Every receipt says how much it read."],
  ["Expiry can’t unsay a yes.", "So what they learn is one word."],
];

function Word({ text, i, of, progress, still }) {
  const opacity = useTransform(progress, [i / of, (i + 1) / of], [0.16, 1]);
  return <motion.span style={still ? undefined : { opacity }}>{text} </motion.span>;
}

function Limit({ head, note, n }) {
  const ref = useRef(null);
  const still = Boolean(useReducedMotion());
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 90%", "start 55%"] });
  const shown = useTransform(scrollYProgress, [0.8, 1], [0, 1]);
  const words = head.split(" ");
  return (
    <li ref={ref}>
      <sup className="tnum">{n}</sup>
      <div>
        <p className="lp-print-head">
          {words.map((w, i) => (
            <Word key={i} text={w} i={i} of={words.length} progress={scrollYProgress} still={still} />
          ))}
        </p>
        <motion.p className="lp-print-note" style={still ? undefined : { opacity: shown }}>
          {note}
        </motion.p>
      </div>
    </li>
  );
}

/** What it doesn't do, set bigger than anything it does. The words ink in as you read. */
export default function SmallPrint() {
  return (
    <section id="small-print" className="lp-print lp-band">
      <div className="lp-wrap">
        <p className="lp-kicker">What we don’t claim</p>
        <h2 className="lp-title">
          The small print,
          <br />
          <em>in large print.</em>
        </h2>
        <ol>
          {LIMITS.map(([head, note], i) => (
            <Limit key={head} head={head} note={note} n={i + 1} />
          ))}
        </ol>
      </div>
    </section>
  );
}
