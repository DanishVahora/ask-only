import { useId } from "react";
import clsx from "clsx";

/* Wax does not set in a circle. A few overlaid waves make an edge that reads as
 * poured rather than drawn, computed once. */
const WAX = (() => {
  const steps = 72;
  let d = "";
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const r = 28.4 + 1.5 * Math.sin(5 * t + 0.6) + 1.0 * Math.sin(8 * t + 2.1) + 0.5 * Math.sin(13 * t);
    d += `${i ? "L" : "M"}${(32 + r * Math.cos(t)).toFixed(2)} ${(32 + r * Math.sin(t)).toFixed(2)}`;
  }
  return `${d}Z`;
})();

/** The seal, pressed with the product's own mark. */
export function WaxSeal({ className }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={clsx("drop-shadow-[0_2px_3px_rgba(4,18,13,0.45)]", className)}>
      <defs>
        <radialGradient id={`${id}-w`} cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#2a7a58" />
          <stop offset="48%" stopColor="#145238" />
          <stop offset="100%" stopColor="#0a3021" />
        </radialGradient>
        <radialGradient id={`${id}-p`} cx="60%" cy="66%" r="70%">
          <stop offset="0%" stopColor="#1a5f43" />
          <stop offset="100%" stopColor="#0d3a29" />
        </radialGradient>
      </defs>
      <path d={WAX} fill={`url(#${id}-w)`} />
      <circle cx="32" cy="32" r="20" fill={`url(#${id}-p)`} />
      <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.9" />
      <circle cx="32" cy="32" r="21.2" fill="none" stroke="rgba(0,0,0,0.26)" strokeWidth="0.9" />
      {/* The mark from Mark.jsx, pressed: one colour, its line a groove the wax shows through. */}
      <path
        transform="translate(25.69 23.5) scale(0.02742)"
        fillRule="evenodd"
        fill="rgba(244,243,220,0.82)"
        d="M37 0H423A37 37 0 0 1 460 37V518.8L358.8 620H37A37 37 0 0 1 0 583V37A37 37 0 0 1 37 0ZM98 270H362A40 40 0 0 1 362 350H98A40 40 0 0 1 98 270Z"
      />
    </svg>
  );
}

const LINES = [78, 52, 92, 66, 96, 58, 84, 44, 72, 90, 36];

/**
 * The document, sealed. This is the one rich thing on the screen, and it shows
 * something true rather than decorating: while your vault is locked every line is
 * grey and nothing is readable; while it is answering, a couple of lines light up,
 * because a couple of lines is all the enclave is ever given.
 */
export function SealedPaper({ lit = false, className }) {
  return (
    // Position comes from the caller, on this outer element alone. The stack inside
    // needs `relative`, and the two on one element fight: `relative` wins in
    // Tailwind's order, which dropped the whole paper into the flow over the headline.
    <div aria-hidden className={clsx("w-[252px] select-none", className)}>
      <div className="relative">
        {/* the sheets under it */}
        <div className="absolute inset-0 translate-x-2 translate-y-1.5 rotate-[3.5deg] rounded-[8px] bg-[#e5e2d4] shadow-[0_18px_40px_rgba(4,18,13,0.4)]" />
        <div className="absolute inset-0 translate-x-0.5 rotate-[1.5deg] rounded-[8px] bg-[#f0eee2]" />
        <div className="relative rounded-[8px] bg-[#fbfaf3] px-6 pb-14 pt-7 shadow-[0_2px_8px_rgba(4,18,13,0.25)]">
          <div className="mb-5 h-[7px] w-[46%] rounded-full bg-[rgba(27,26,22,0.72)]" />
          <div className="space-y-[11px]">
            {LINES.map((w, i) => (
              <div
                key={i}
                style={{ width: `${w}%` }}
                className={clsx(
                  "h-[6px] rounded-full transition-colors duration-700",
                  lit && (i === 4 || i === 5) ? "bg-[#6fcf97]" : "bg-[rgba(27,26,22,0.1)]",
                )}
              />
            ))}
          </div>
          <WaxSeal className="absolute bottom-3 right-9 h-[68px] w-[68px]" />
        </div>
      </div>
    </div>
  );
}
