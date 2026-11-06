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
export default function ConnectButton({ size = "sm", className, tone = "light" }) {
  const dark = tone === "dark";
  const { address, isConnected, connector: active } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // wagmi always lists the generic injected() connector, even when no wallet
  // is installed, and its name is the literal string "Injected" — which must
  // never reach a button. Drop it when a real EIP-6963 wallet announced
  // itself, keep it only as a last resort, and give it a human name.
  const hasInjectedProvider = typeof window !== "undefined" && Boolean(window.ethereum);
  const seen = new Set();
  const wallets = connectors
    .filter((c) => {
      const name = (c.name || "").trim();
      if (!name) return false;
      const generic = /^injected$/i.test(name);
      // a generic entry is only useful if nothing specific was discovered
      if (generic && connectors.some((o) => !/^injected$/i.test((o.name || "").trim()))) return false;
      if (generic && !hasInjectedProvider) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => ({
      connector: c,
      name: /^injected$/i.test((c.name || "").trim()) ? "Browser wallet" : c.name,
      icon: c.icon,
      uid: c.uid,
    }));

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
        className={clsx("btn", size === "sm" && "btn-sm", dark && "btn-on-forest", className)}
        onClick={() => disconnect()}
        title={`${active?.name ?? "Wallet"} — click to disconnect`}
      >
        {active?.icon && <img src={active.icon} alt="" className="h-4 w-4 rounded-[3px]" />}
        <span className="min-w-0 truncate font-mono tnum">{short(address, 6, 4)}</span>
        <LogOut size={14} strokeWidth={1.75} className={clsx(dark && "ml-auto")} />
      </button>
    );
  }

  if (wallets.length === 0) {
    return (
      <a
        className={clsx("btn", size === "sm" ? "btn-sm" : "btn-lg", dark && "btn-on-forest", className)}
        href="https://ethereum.org/en/wallets/find-wallet/"
        target="_blank"
        rel="noreferrer"
        title="AskOnly needs a browser wallet — your address is your identity here"
      >
        <Wallet size={size === "sm" ? 15 : 18} />
        Install a wallet
      </a>
    );
  }

  // One wallet installed? Don't make them pick from a list of one.
  if (wallets.length === 1) {
    const only = wallets[0];
    return (
      <button
        className={clsx("btn", dark ? "btn-mint" : "btn-primary", size === "sm" ? "btn-sm" : "btn-lg", className)}
        onClick={() => connect({ connector: only.connector })}
        disabled={isPending}
      >
        {only.icon ? (
          <img src={only.icon} alt="" className="h-4 w-4 rounded-[3px]" />
        ) : (
          <Wallet size={size === "sm" ? 15 : 18} />
        )}
        {isPending
          ? "Check your wallet…"
          : only.name === "Browser wallet"
            ? "Connect wallet"
            : `Connect ${only.name}`}
      </button>
    );
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        className={clsx("btn", dark ? "btn-mint" : "btn-primary", size === "sm" ? "btn-sm" : "btn-lg", className)}
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
            style={{ transformOrigin: dark ? "bottom left" : "top right" }}
            className={clsx(
              "absolute z-[70] w-[248px] rounded-[14px] border border-line bg-paper p-1.5 text-ink shadow-[0_8px_24px_rgba(16,26,21,0.18)]",
              dark ? "bottom-full left-0 mb-2" : "right-0 mt-2",
            )}
          >
            <p className="eyebrow px-2.5 py-2">{wallets.length} wallets found</p>
            {wallets.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c.connector });
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2.5 text-left text-[0.875rem] font-medium transition-colors hover:bg-cream"
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
