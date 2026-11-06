import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Copy, Check, Ban } from "lucide-react";
import clsx from "clsx";
import { remaining, short } from "../lib/askonly.js";

/**
 * A permission, as an object rather than a table row.
 *
 * This is the one place on the screen that gets real craft, because it is the
 * only thing here that is genuinely this product: a capability issued to a
 * named person, carrying one question, counting down to its own death. A list
 * row would describe it; this is meant to BE it.
 *
 * The devices are borrowed from the thing it actually resembles — a bond
 * receipt. A perforated tear line with punched ends, the question set in serif
 * because it is the content rather than a label, and a meter that is the last
 * ten minutes of life rather than the whole term, so a 7-day permission does
 * not look identical to a 2-minute one for six days.
 */
export default function PermissionTicket({ grant, onRevoke }) {
  const [r, setR] = useState(() => remaining(grant.diesAt));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setR(remaining(grant.diesAt));
    if (remaining(grant.diesAt).dead) return;
    const id = setInterval(() => setR(remaining(grant.diesAt)), 1000);
    return () => clearInterval(id);
  }, [grant.diesAt]);

  const dying = !r.dead && r.ms < 60_000;
  // The bar only EXISTS inside the last ten minutes. Showing one for a 7-day
  // grant meant a full green bar for six days that then collapsed - the
  // component claimed to solve exactly that and did not.
  const inFinalStretch = !r.dead && r.ms <= 600_000;
  const spent = grant.usesSpent >= grant.usesAllowed;
  const over = r.dead || spent || grant.state === "revoked";
  const link = `${location.origin}/ask?grant=${grant.grantId}`;
  const pct = inFinalStretch ? Math.min(100, (r.ms / 600_000) * 100) : 0;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={clsx(
        "relative overflow-hidden rounded-[14px] border-[1.6px] transition-colors",
        over ? "border-line-2 bg-cream-2" : "border-ink bg-paper",
      )}
    >
      {/* upper half — who, and what they may ask */}
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className={clsx("truncate text-[0.9375rem] font-semibold", over && "text-ink-50")}>
              {grant.verifierName || short(grant.verifier, 10, 6)}
            </p>
            <p className="mt-0.5 font-mono tnum text-[0.6875rem] text-ink-30">
              {short(grant.verifier, 10, 8)}
            </p>
          </div>
          <span
            className={clsx(
              "shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.1em]",
              r.dead ? "text-ink-30" : spent ? "text-ink-30" : dying ? "text-clay" : "text-seal",
            )}
          >
            {r.dead ? "expired" : spent ? "spent" : grant.state === "revoked" ? "revoked" : "live"}
          </span>
        </div>

        <p
          className={clsx(
            "mt-3 font-serif text-[1.25rem] leading-[1.15] tracking-[-0.02em]",
            over ? "text-ink-30" : "text-ink",
          )}
        >
          {/* A grant is a RIGHT, not a question - the verifier writes the
              question themselves - and the scope is the owner's own words. */}
          They may ask about <span className="italic">{grant.note || "this document"}</span>.
        </p>
      </div>

      {/* the tear line, punched at both ends like the receipt it is */}
      <div className="relative h-0">
        <div className="absolute inset-x-5 top-0 border-t border-dashed border-line-2" />
        <span className="absolute -left-[7px] -top-[7px] h-[14px] w-[14px] rounded-full border-[1.6px] border-inherit bg-cream"
          style={{ borderColor: over ? "rgba(26,26,26,.22)" : "#1a1a1a" }} />
        <span className="absolute -right-[7px] -top-[7px] h-[14px] w-[14px] rounded-full border-[1.6px] bg-cream"
          style={{ borderColor: over ? "rgba(26,26,26,.22)" : "#1a1a1a" }} />
      </div>

      {/* lower half — the clock */}
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-baseline justify-between gap-4 font-mono tnum text-[0.75rem]">
          <span className={over ? "text-ink-30" : "text-ink-50"}>
            {grant.usesSpent} of {grant.usesAllowed} asked
          </span>
          <span className={clsx(dying && "text-clay", over ? "text-ink-30" : "font-semibold text-ink")}>
            {r.dead ? "—" : r.showBlocks ? `${r.blocks.toLocaleString()} blocks` : r.text}
          </span>
        </div>

        {/* Transform, not width: animating width re-fired by the 1s tick never
            settles. The bar appearing at all is the warning; its drain is the
            clock. */}
        {inFinalStretch && (
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
            <div
              className={clsx(
                "h-full origin-left rounded-full transition-transform duration-1000 ease-linear",
                dying ? "bg-clay" : "bg-seal",
              )}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono tnum text-[0.6875rem] text-ink-50">
            {r.dead ? "the network stopped returning it" : r.showBlocks ? r.text : `${r.blocks.toLocaleString()} blocks`}
          </span>
          {!over && (
            <div className="flex items-center gap-1">
              <button
                className="btn btn-sm btn-quiet px-2 py-1 text-[0.75rem]"
                onClick={() => {
                  navigator.clipboard?.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Link"}
              </button>
              <button
                className="btn btn-sm btn-quiet px-2 py-1 text-[0.75rem] text-ink-50 hover:text-clay"
                onClick={() => onRevoke?.(grant)}
              >
                <Ban size={13} />Revoke
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.article>
  );
}
