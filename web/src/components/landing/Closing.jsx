import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useInView } from "motion/react";
import { Lock } from "lucide-react";

export default function Closing() {
  const ref = useRef(null);
  const seen = useInView(ref, { amount: 0.5, once: true });
  return (
    <section className="lp-close lp-band">
      <div className="lp-wrap lp-close-in" ref={ref}>
        <h2 className="lp-display">
          They never had the document.
          <br />
          <em>There is nothing to delete.</em>
        </h2>
        <Link className="lp-btn" to="/documents">
          <Lock size={18} strokeWidth={2.2} />
          Seal a document
        </Link>
        <motion.div
          className="pp-stamp is-marker lp-close-stamp"
          aria-hidden="true"
          initial={{ scale: 1.7, opacity: 0, rotate: 2 }}
          animate={seen ? { scale: 1, opacity: 1, rotate: 9 } : {}}
          transition={{ delay: 0.35, duration: 0.17, ease: [0.55, 0, 1, 0.45] }}
        >
          Never held
        </motion.div>
      </div>
    </section>
  );
}
