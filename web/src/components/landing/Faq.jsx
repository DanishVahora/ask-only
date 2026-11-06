import { useState } from "react";
import { Plus } from "lucide-react";
import clsx from "clsx";

const QA = [
  ["Do I have to approve every question?", "No. You choose who and for how long, once. Your browser answers the rest by itself."],
  ["Does your server see my document?", "No. Your browser decrypts it and talks to the enclave directly. Our server pays the fees, and can’t write a record without a signature from you or your reviewer."],
  ["Why not zero-knowledge proofs?", "They need documents an issuer has signed. Real payslips and leases are unsigned scans."],
  ["What stops you faking a receipt?", "At 0G’s end, nothing: it doesn’t sign answers, and we say so. A receipt names the machine that answered, checked against 0G’s list, and carries the reviewer’s own signature."],
];

export default function Faq() {
  const [open, setOpen] = useState(-1);
  return (
    <section id="questions" className="lp-faq">
      <div className="lp-wrap lp-faq-in">
        <div className="lp-faq-side">
          <p className="lp-kicker">Questions</p>
          <h2 className="lp-title">
            Ask us anything.
            <br />
            <em>We’ll use more than one word.</em>
          </h2>
        </div>
        <ul>
          {QA.map(([q, a], i) => {
            const on = open === i;
            return (
              <li key={q}>
                <button type="button" aria-expanded={on} onClick={() => setOpen(on ? -1 : i)}>
                  {q}
                  <Plus size={20} strokeWidth={2} className={clsx(on && "is-on")} />
                </button>
                <div className={clsx("lp-faq-a", on && "is-open")}>
                  <div>
                    <p className="lp-body">{a}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
