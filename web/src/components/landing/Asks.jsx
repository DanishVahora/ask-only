import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";

const ROWS = [
  ["Your landlord wants", "your payslip"],
  ["Your bank wants", "six months of statements"],
  ["The visa office wants", "all of the above"],
];

function Row({ who, what, i, progress, still }) {
  const n = ROWS.length;
  const from = i / n;
  const strike = useTransform(progress, [from, from + 0.55 / n], [0, 1]);
  const dim = useTransform(progress, [from, from + 0.55 / n], [1, 0.42]);
  const word = useTransform(progress, [from + 0.45 / n, from + 0.95 / n], [0, 1]);
  const slide = useTransform(progress, [from + 0.45 / n, from + 0.95 / n], [-14, 0]);
  return (
    <li>
      {who}{" "}
      <motion.span className="lp-asks-old" style={still ? { opacity: 0.42 } : { opacity: dim }}>
        {what}
        <motion.i style={still ? { scaleX: 1 } : { scaleX: strike }} />
      </motion.span>{" "}
      <motion.em style={still ? undefined : { opacity: word, x: slide }}>one word.</motion.em>
    </li>
  );
}

/** What they ask for, struck through by your scrolling, and what they actually need. */
export default function Asks() {
  const ref = useRef(null);
  const still = Boolean(useReducedMotion());
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 60%"] });
  return (
    <section className="lp-asks lp-band">
      <div className="lp-wrap">
        <p className="lp-kicker">What they ask for, and what they need</p>
        <ol ref={ref}>
          {ROWS.map(([who, what], i) => (
            <Row key={who} who={who} what={what} i={i} progress={scrollYProgress} still={still} />
          ))}
        </ol>
      </div>
    </section>
  );
}
