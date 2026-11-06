import { useEffect, useId, useState } from "react";
import { motion } from "motion/react";
import { Eye, EyeOff } from "lucide-react";
import clsx from "clsx";

/** The product's signature: a tear line with both ends punched out of the tile. */
export const Perf = ({ className }) => <div aria-hidden className={clsx("perf", className)} />;

/** One short fade and rise on load, staggered a little. Nothing flies in. */
export function Rise({ i = 0, className, children }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.04, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** The top of every page: a plain noun, a sentence, and at most one action. */
export function PageHead({ kicker, title, lead, children }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {kicker && <p className="eyebrow mb-3">{kicker}</p>}
        <h1 className="page-title">{title}</h1>
        {lead && <p className="mt-3 max-w-[52ch] text-[1rem] leading-relaxed text-ink-70">{lead}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </header>
  );
}

/** Re-render on a timer, for anything showing time left. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** What came back, as a small mark. */
export function Stamp({ answer }) {
  const a = String(answer ?? "").toLowerCase();
  const text = { yes: "Yes", no: "No", unknown: "Unknown", refused: "Turned down", waiting: "Waiting" }[a] ?? a;
  // Waiting isn't a verdict yet, so it doesn't get stamped.
  if (a === "waiting") return <span className="tag tag-warn shrink-0">{text}</span>;
  return (
    <span className={clsx("stamp shrink-0", a === "yes" && "stamp-yes", (a === "no" || a === "refused") && "stamp-no")}>
      {text}
    </span>
  );
}

/**
 * A question on its way: a small sheet whose lines are blacked out one by one, with
 * one picked out in highlighter, over and over until the answer is stamped. It's a
 * picture of what happens, not a claim about which step is happening right now.
 * Waiting for a browser that isn't open is stiller: the sheet just sits and breathes.
 */
export function Reading({ waiting = false, className }) {
  return (
    <span aria-hidden className={clsx("reading", waiting && "is-waiting", className)}>
      {[0, 1, 2, 3, 4].map((n) => (
        <i key={n} style={{ "--n": n }} />
      ))}
    </span>
  );
}

/** A passphrase field. A typo at sealing time locks a document for good, so you can look. */
export function PassField({ value, onChange, placeholder, autoFocus, onEnter, label = "Passphrase" }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          className="input pr-11 font-mono text-[0.875rem]"
          type={show ? "text" : "password"}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
        />
        <button
          type="button"
          aria-label={show ? "Hide passphrase" : "Show passphrase"}
          onClick={() => setShow((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[8px] p-2 text-ink-50 transition-colors hover:bg-cream hover:text-ink"
        >
          {show ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

/** Pick one of a few. Everything on screen at once, unlike a select. */
export function Segmented({ label, value, onChange, options }) {
  const id = useId();
  return (
    <div>
      {label && <p className="field-label">{label}</p>}
      <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-[12px] bg-cream-2 p-1">
        {options.map((o) => {
          const on = String(o.value) === String(value);
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={clsx(
                "relative h-9 min-w-0 flex-1 rounded-[8px] px-2 text-[0.8125rem] font-medium transition-colors",
                on ? "text-ink" : "text-ink-50 hover:text-ink",
              )}
            >
              {on && (
                <motion.span
                  layoutId={`seg-${id}`}
                  className="absolute inset-0 rounded-[8px] bg-marker"
                  transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                />
              )}
              <span className="relative truncate">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A label and its value, in a receipt. */
export function Fact({ k, v, mono = true }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="shrink-0 text-ink-50">{k}</dt>
      <dd className={clsx("m-0 min-w-0 truncate text-right text-ink-70", mono && "font-mono tnum")}>{v}</dd>
    </div>
  );
}
