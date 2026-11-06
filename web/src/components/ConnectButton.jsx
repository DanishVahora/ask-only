import { useState, useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { motion, AnimatePresence } from "motion/react";
import { Wallet, LogOut, Check } from "lucide-react";
import clsx from "clsx";
import { short } from "../lib/askonly.js";

/**
 * Connect with whatever wallet you actually have.
 *
 * wagmi's EIP-6963 discovery means every installed wallet announces itself and
 * arrives as its own connector carrying its own name and icon — MetaMask,
 * Rabby, Coinbase, Brave, OKX, Phantom, Frame. We render what is there rather
 * than naming one and hoping.
 *
 * De-duplicated by name because the legacy injected() fallback and the 6963
 * announcement are often the same wallet twice.
 */
export default function ConnectButton({ size = "sm", className }) {
  const { address, isConnected, connector: active } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const seen = new Set();
  const wallets = connectors.filter((c) => {
    const key = (c.name || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (isConnected) {
    return (
      <button
        className={clsx("btn", size === "sm" && "btn-sm", className)}
        onClick={() => disconnect()}
        title={`${active?.name ?? "Wallet"} — click to disconnect`}
      >
        {active?.icon && <img src={active.icon} alt="" className="h-4 w-4 rounded-[3px]" />}
        <span className="font-mono tnum">{short(address, 6, 4)}</span>
        <LogOut size={14} />
      </button>
    );
  }

  if (wallets.length === 0) {
    return (
      <a
        className={clsx("btn", size === "sm" ? "btn-sm" : "btn-lg", className)}
        href="https://ethereum.org/en/wallets/find-wallet/"
        target="_blank"
        rel="noreferrer"
      >
        <Wallet size={size === "sm" ? 15 : 18} />
        No wallet found
      </a>
    );
  }

  // One wallet installed? Don't make them pick from a list of one.
  if (wallets.length === 1) {
    const only = wallets[0];
    return (
      <button
        className={clsx("btn btn-primary", size === "sm" ? "btn-sm" : "btn-lg", className)}
        onClick={() => connect({ connector: only })}
        disabled={isPending}
      >
        {only.icon ? (
          <img src={only.icon} alt="" className="h-4 w-4 rounded-[3px]" />
        ) : (
          <Wallet size={size === "sm" ? 15 : 18} />
        )}
        {isPending ? "Check your wallet…" : `Connect ${only.name}`}
      </button>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        className={clsx("btn btn-primary", size === "sm" ? "btn-sm" : "btn-lg", className)}
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
      >
        <Wallet size={size === "sm" ? 15 : 18} />
        {isPending ? "Check your wallet…" : "Connect wallet"}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 z-[70] mt-2 w-[248px] rounded-[14px] border-[1.6px] border-ink bg-cream p-1.5"
          >
            <p className="px-2.5 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-ink-50">
              {wallets.length} wallets found
            </p>
            {wallets.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2.5 text-left text-[0.875rem] font-medium transition-colors hover:bg-cream-2"
              >
                {c.icon ? (
                  <img src={c.icon} alt="" className="h-5 w-5 rounded-[4px]" />
                ) : (
                  <span className="grid h-5 w-5 place-items-center rounded-[4px] border border-line-2">
                    <Wallet size={11} />
                  </span>
                )}
                <span className="flex-1 truncate">{c.name}</span>
                {active?.uid === c.uid && <Check size={14} className="text-seal" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="absolute right-0 top-full mt-1 w-[248px] text-right text-[0.6875rem] text-clay">
          {error.shortMessage ?? error.message}
        </p>
      )}
    </div>
  );
}
