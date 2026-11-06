import { useEffect, useState } from "react";
import clsx from "clsx";
import { remaining } from "../lib/askonly.js";

/**
 * A permission counting down.
 *
 * It counts in BLOCKS, because that is the unit Arkiv actually enforces expiry
 * in — but six figures of blocks is noise, so past about a day the human
 * duration leads and the block count moves to the side.
 *
 * The bar is scaled to the last ten minutes of life on purpose: a 7-day grant
 * should not look identical to a 2-minute one for six days.
 */
export default function Countdown({ diesAt, className }) {
  const [r, setR] = useState(() => remaining(diesAt));

  useEffect(() => {
    setR(remaining(diesAt));
    if (remaining(diesAt).dead) return;
    const id = setInterval(() => setR(remaining(diesAt)), 1000);
    return () => clearInterval(id);
  }, [diesAt]);

  const pct = r.dead ? 0 : Math.max(0, Math.min(100, (r.ms / 600_000) * 100));
  const dying = !r.dead && r.ms < 60_000;

  return (
    <div className={clsx("mt-2", className)}>
      <div className="flex items-baseline justify-between gap-3 font-mono tnum text-[0.75rem] text-ink-50">
        <span>
          {r.dead ? (
            "expired"
          ) : (
            <>
              dies in <span className="font-semibold text-ink">{r.showBlocks ? `${r.blocks} blocks` : r.text}</span>
            </>
          )}
        </span>
        {!r.dead && <span>{r.showBlocks ? r.text : `${r.blocks.toLocaleString()} blocks`}</span>}
      </div>
      <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-line">
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            r.dead ? "bg-line-2" : dying ? "bg-clay" : "bg-seal",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
