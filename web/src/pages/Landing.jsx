import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView } from "motion/react";
import { Lock, ArrowRight, X, ChevronDown } from "lucide-react";
import clsx from "clsx";

const DOC = [
  { t: "Tata Consultancy Services Ltd", keep: false },
  { t: "PAN ABCDE1234F", keep: false },
  { t: "HDFC 50100234567891", keep: false },
  { t: "14 Hill Road, Bandra West", keep: false },
  { t: "Gross 68,000", keep: true },
  { t: "Net pay 62,960", keep: true },
];

/** The one live moment. The document is never given a transform — that is the
 *  whole point of it. What moves is a question, and one bit coming back. */
function Stage() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [phase, setPhase] = useState("idle"); // idle | narrow | enclave | done | refused
  const [sent, setSent] = useState([]);
  const runRef = useRef(0);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function play(permitted = true) {
    const mine = ++runRef.current;
    setSent([]);
    setPhase("narrow");
    if (!permitted) {
      await sleep(600);
      if (mine !== runRef.current) return;
      setSent(DOC.map((_, i) => i));
      setPhase("refused");
      return;
    }
    for (let i = 0; i < DOC.length; i += 1) {
      await sleep(110);
      if (mine !== runRef.current) return;
      setSent((s) => [...s, i]);
    }
    setPhase("enclave");
    await sleep(1600);
    if (mine !== runRef.current) return;
    setPhase("done");
  }

  useEffect(() => {
    if (inView) play(true);
  }, [inView]);

  return (
    <div ref={ref} className="mx-auto mt-14 max-w-[940px] rounded-xl border-[1.6px] border-ink bg-paper p-7">
      <div className="grid items-stretch gap-4 md:grid-cols-[1fr_130px_1fr]">
        {/* the document */}
        <figure className="m-0 flex flex-col gap-3 rounded-[12px] border border-line-2 bg-cream-2 p-4">
          <span className={clsx("tag self-start", phase === "refused" ? "tag-stop" : phase === "done" ? "tag-on" : "")}>
            {phase === "refused" ? "not opened" : phase === "done" ? "never left this card" : "encrypted · stays here"}
          </span>
          <ul className="m-0 list-none space-y-[3px] p-0">
            {DOC.map((l, i) => {
              const touched = sent.includes(i);
              const given = touched && l.keep && phase !== "refused";
              const held = touched && (!l.keep || phase === "refused");
              return (
                <li key={l.t}
                  className={clsx(
                    "truncate rounded-[5px] px-2 py-[3px] font-mono text-[0.75rem] leading-relaxed transition-all duration-300",
                    given && "bg-seal-wash text-seal",
                    held && "line-through opacity-35",
                    !touched && "text-ink-70",
                  )}>
                  {l.t}
                </li>
              );
            })}
          </ul>
        </figure>

        {/* the wire */}
        <div className="hidden flex-col items-center justify-center gap-3 md:flex">
          <p className={clsx(
            "text-center font-mono text-[0.6875rem] transition-colors",
            phase === "refused" ? "text-clay line-through" : phase === "idle" ? "text-ink-30" : "text-seal",
          )}>
            {phase === "refused" ? "exact salary ?" : "income > ₹50,000 ?"}
          </p>
          <div className="relative h-[2px] w-full"
            style={{ background: "repeating-linear-gradient(to right, rgba(26,26,26,.22) 0 3px, transparent 3px 7px)" }}>
            <motion.span
              className="absolute -top-1 h-[10px] w-[10px] rounded-full border-[1.6px] border-ink bg-mint"
              animate={{
                left: phase === "enclave" ? "100%" : "0%",
                opacity: phase === "enclave" ? 1 : 0,
              }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>

        {/* the enclave */}
        <div className={clsx(
          "flex min-h-[150px] flex-col gap-2 rounded-[12px] bg-forest p-4 text-on-forest transition-all",
          phase === "enclave" && "outline outline-[1.6px] -outline-offset-[1.6px] outline-mint",
        )}>
          <p className="font-mono text-[0.6875rem] text-on-forest-2">Intel TDX enclave</p>
          <div className="flex flex-1 items-center">
            {phase === "done" ? (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", bounce: 0.35, duration: 0.5 }}
                className="font-mono text-[2rem] font-semibold tracking-tight text-mint">YES</motion.span>
            ) : phase === "refused" ? (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                className="font-mono text-[2rem] font-semibold tracking-tight text-[#f0a59c]">NO</motion.span>
            ) : (
              <span className="font-mono text-[0.75rem] text-on-forest-2 opacity-60">
                {phase === "enclave" ? "reasoning…" : "waiting"}
              </span>
            )}
          </div>
          <p className="font-mono text-[0.6875rem] text-on-forest-2 opacity-70">glm-5.3 · trust_mode private</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <p className="max-w-[46ch] text-[0.875rem] text-ink-70">
          {phase === "refused"
            ? "Refused on-chain. The role check failed, so the enclave was never called and the document was never decrypted."
            : phase === "done"
              ? "One bit crossed. The document never moved, and two of its six lines were all the enclave saw."
              : "The document never leaves this card."}
        </p>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => play(false)}>Ask the wrong thing</button>
          <button className="btn btn-primary btn-sm" onClick={() => play(true)}>Ask the permitted question</button>
        </div>
      </div>
    </div>
  );
}

const Band = ({ children, className }) => (
  <section className={clsx("rounded-t-[80px] bg-forest px-5 py-28 text-on-forest-2 max-md:rounded-t-[40px]", className)}>
    <div className="mx-auto max-w-[760px] text-center">{children}</div>
  </section>
);

function QA({ q, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line py-5 first:border-t">
      <button onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 text-left text-[1.0625rem] font-semibold tracking-[-0.012em]">
        {q}
        <ChevronDown size={18} className={clsx("shrink-0 text-ink-50 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className="mt-4 max-w-[62ch] overflow-hidden text-[0.9375rem] leading-relaxed text-ink-70">
          {children}
        </motion.p>
      )}
    </div>
  );
}

export default function Landing() {
  return (
    <>
      <section className="px-5 pb-24 pt-24 text-center max-md:pt-16">
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }} className="eyebrow">
          AskOnly · consent layer
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-5 max-w-[16ch] text-[clamp(3.1rem,1.5rem+6.2vw,6rem)]">
          Don’t send the file,<br /><span className="italic">just answer.</span>
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-6 max-w-[34ch] text-[clamp(1.0625rem,1rem+0.35vw,1.25rem)] leading-snug">
          Your landlord wants to know you earn enough. He needs one bit — not your payslip,
          your PAN, your bank account and your address.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.18, ease: [0.22, 1, 0.36, 1] }} className="mt-8">
          <Link className="btn btn-primary btn-lg" to="/vault"><Lock size={18} />Put a document in</Link>
          <p className="mt-6 text-[0.8125rem] text-ink-50">
            Runs on your machine · your browser holds the key · nothing in the answer path but you
          </p>
        </motion.div>
      </section>

      <section className="px-5 pb-24">
        <div className="mx-auto max-w-[1180px]">
          <p className="eyebrow text-center">Each layer doing the one thing only it can do</p>
          <div className="mt-6 flex flex-wrap justify-center gap-x-24 gap-y-6 border-t border-line pt-6">
            {[["ENSv2", "who may ask what"], ["0G Private Compute", "the only reader"], ["Arkiv", "until when"]].map(
              ([n, d]) => (
                <div key={n} className="text-center">
                  <p className="font-serif text-[1.375rem] tracking-[-0.02em]">{n}</p>
                  <p className="text-[0.8125rem] text-ink-50">{d}</p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="px-5 pb-28">
        <div className="mx-auto max-w-[1180px] text-center">
          <h2 className="text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]">
            Watch the document <span className="italic">stay put.</span>
          </h2>
          <Stage />
        </div>
      </section>

      <Band>
        <p className="eyebrow !text-[rgba(244,243,220,0.55)]">What the enclave actually saw</p>
        <p className="my-6 font-serif text-[clamp(3.5rem,2rem+7vw,7rem)] leading-none tracking-[-0.035em] text-on-forest">
          4 of 12 lines
        </p>
        <p className="mx-auto max-w-[46ch] text-[1.0625rem] leading-snug text-on-forest">
          Your employer, your PAN, your account number and your address never entered it.
          Not withheld from the landlord — <span className="italic">withheld from the model.</span>
        </p>
      </Band>

      <section className="px-5 py-28">
        <div className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]">
            Every company promises to delete your data.<br />
            <span className="italic">None of them can prove they did.</span>
          </h2>
          <p className="mx-auto mt-8 max-w-[62ch] text-[0.9375rem] leading-relaxed text-ink-70">
            That is a theorem, not a complaint. Broadbent and Islam proved certified deletion is
            impossible using classical information, because classical ciphertexts can be copied.
            What the industry calls <em>proof of deletion</em> is a form with somebody’s phone number on it.
          </p>
          <p className="mx-auto mt-12 max-w-[26ch] border-t border-line pt-10 font-serif text-[clamp(1.5rem,1.1rem+1.6vw,2.25rem)] leading-tight tracking-[-0.025em]">
            You can never prove you deleted it.<br />
            <span className="italic">You can prove you never held it.</span>
          </p>
        </div>
      </section>

      <section className="px-5 pb-28">
        <div className="mx-auto max-w-[1180px]">
          <div className="mb-16 text-center">
            <p className="eyebrow">How it works</p>
            <h2 className="mt-3 text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]">
              Three steps, and none of them <span className="italic">move your document.</span>
            </h2>
          </div>
          <ol className="m-0 grid list-none gap-8 p-0 md:grid-cols-3">
            {[
              ["01", "Seal it", "The document encrypts in your browser with a passphrase that never leaves the page. What gets stored is ciphertext carrying its own expiry."],
              ["02", "Hand out a question", "Not a copy — a capability. One question, a few uses, an expiry. Who may ask what is an on-chain role, so revoking is revoking a role."],
              ["03", "Let it die", "Past its death block the network stops returning it and every operation fails. There is nothing to delete, and nobody to trust to do it."],
            ].map(([n, t, d], i) => (
              <li key={n} className={clsx("border-t-[1.6px] border-ink pt-5", i === 1 && "md:pt-10", i === 2 && "md:pt-16")}>
                <p className="font-mono text-[0.75rem] text-ink-50">{n}</p>
                <h3 className="mt-3 font-sans text-[1.25rem] font-semibold tracking-[-0.015em]">{t}</h3>
                <p className="mt-3 text-[0.875rem] leading-relaxed text-ink-70">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Band>
        <h2 className="text-[clamp(2rem,1.3rem+2.6vw,3.25rem)] text-on-forest">
          Keeping a permission alive <span className="italic">leaves a mark.</span><br />Letting it die does not.
        </h2>
        <p className="mx-auto mt-8 max-w-[62ch] text-[0.9375rem] leading-relaxed">
          Arkiv emits a public event when a record is extended, and nothing at all when one expires.
          So retention is a signed, timestamped act — and silence means the permission was allowed
          to lapse. The burden of proof inverts.
        </p>
        <div className="mt-12 grid gap-6 text-left sm:grid-cols-2">
          {[["Let it expire", "0 events", "silent, free, the default"],
            ["Keep it alive", "1 signed tx", "public, timestamped, yours to explain"]].map(([k, v, d], i) => (
            <div key={k} className={clsx("rounded-[12px] border border-[rgba(244,243,220,0.16)] p-5", i === 1 && "bg-forest-2")}>
              <p className="eyebrow !text-[rgba(244,243,220,0.55)]">{k}</p>
              <p className="my-3 font-serif text-[clamp(1.75rem,1.2rem+2vw,2.75rem)] leading-none tracking-[-0.03em] text-on-forest">{v}</p>
              <p className="text-[0.75rem]">{d}</p>
            </div>
          ))}
        </div>
      </Band>

      <section className="px-5 py-28">
        <div className="mx-auto max-w-[760px]">
          <div className="text-center">
            <p className="eyebrow">What we don’t claim</p>
            <h2 className="mt-3 text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]">
              The boundary, <span className="italic">before you find it.</span>
            </h2>
          </div>
          <ul className="mt-14 m-0 list-none space-y-5 p-0">
            {[
              ["We do not erase bytes from history.", "Expiry means queries stop returning the record and operations fail. The document is ciphertext encrypted in your browser — that is what protects the bytes."],
              ["The enclave does not enforce our policy.", "0G is an inference router, not a place to deploy code. Enforcement lives at the client and the verifier, and we say so."],
              ["0G does not sign the answer.", "Its router exposes no signature endpoint — we probed eight paths with a live request id, all 404. So a receipt is bound by provider address, never by a signature we never got."],
              ["Expiry kills the capability, not knowledge.", "A landlord told “yes” still knows “yes”. We shrink what is disclosed to one bit. Nothing makes knowledge revocable."],
            ].map(([b, d]) => (
              <li key={b} className="grid grid-cols-[26px_1fr] items-start gap-4 border-b border-line pb-5 last:border-0">
                <span className="grid h-[26px] w-[26px] place-items-center rounded-full border-[1.4px] border-clay text-clay">
                  <X size={13} />
                </span>
                <p className="text-[0.9375rem] leading-relaxed text-ink-70">
                  <strong className="font-semibold text-ink">{b}</strong> {d}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-5 pb-28">
        <div className="mx-auto max-w-[760px]">
          <h2 className="mb-12 text-center text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]">
            Good <span className="italic">questions.</span>
          </h2>
          <QA q="Isn’t this just ZK selective disclosure?">
            ZK needs an issuer to sign structured data. India’s real documents are unsigned,
            unstructured scans. There is no circuit for a photograph of a payslip and no issuer
            signature to build one over. A model inside an enclave is the first universal adapter
            from real paper to one bit.
          </QA>
          <QA q="What stops you faking a receipt?">
            At the router level, nothing — and we say so. What we do prove is narrower and real:
            the enclave address that answered, checked live against the attested provider list, and
            the verifier’s own signature, produced before they are shown the answer.
          </QA>
          <QA q="Does your server see my document?">
            No. Your browser decrypts locally and calls the enclave directly with your own key. The
            server pays the gas for each record and verifies a signature before writing — so it can
            pay for a record but cannot author one.
          </QA>
          <QA q="Who answers when the verifier asks?">
            You do. Only your device holds the passphrase, so a request lands in your inbox and your
            device decrypts, asks the enclave and signs the answer. The verifier can ask, and only ask.
          </QA>
        </div>
      </section>

      <section className="px-5 pb-32 text-center">
        <div className="mx-auto max-w-[760px]">
          <h2 className="text-[clamp(2rem,1.3rem+2.6vw,3.25rem)]">
            He never had the document.<br /><span className="italic">There is nothing to delete.</span>
          </h2>
          <Link className="btn btn-primary btn-lg mt-10" to="/vault"><Lock size={18} />Put a document in</Link>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-8">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 text-[0.75rem] text-ink-50">
          <span>AskOnly — ETHGlobal Mumbai 2026 · MIT</span>
          <a className="inline-flex items-center gap-1.5 hover:text-ink" href="/ledger">
            See the ledger <ArrowRight size={13} />
          </a>
        </div>
      </footer>
    </>
  );
}
