import { Link, useLocation } from "react-router-dom";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Wallet, LogOut } from "lucide-react";
import clsx from "clsx";
import { api, short } from "../lib/askonly.js";

/** A shape, not a swatch. */
function Mark() {
  return (
    <span
      aria-hidden
      className="inline-block h-[17px] w-[17px] rounded-[4px] bg-forest"
      style={{ clipPath: "polygon(0 0, 100% 0, 100% 58%, 58% 100%, 0 100%)" }}
    />
  );
}

export function ConnectButton({ size = "sm" }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const injected = connectors[0];

  if (isConnected) {
    return (
      <button
        className={clsx("btn", size === "sm" && "btn-sm")}
        onClick={() => disconnect()}
        title="Disconnect"
      >
        <span className="font-mono tnum">{short(address, 6, 4)}</span>
        <LogOut size={14} />
      </button>
    );
  }
  return (
    <button
      className={clsx("btn btn-primary", size === "sm" ? "btn-sm" : "btn-lg")}
      onClick={() => connect({ connector: injected })}
      disabled={isPending || !injected}
    >
      <Wallet size={size === "sm" ? 15 : 18} />
      {isPending ? "Check your wallet…" : !injected ? "No wallet found" : "Connect wallet"}
    </button>
  );
}

/** A live dot, and the only looping animation in the product. */
function ChainDot() {
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: () => api("/api/health"),
    refetchInterval: 20_000,
  });
  const ok = data?.ok;
  return (
    <span
      title={
        ok
          ? `sepolia ${data.chain.block} · arkiv ${data.arkiv.block}`
          : (data?.chain?.reason ?? "connecting…")
      }
      className={clsx(
        "h-[7px] w-[7px] shrink-0 rounded-full",
        ok ? "bg-[#1F9254] breathe" : "bg-ink-30",
      )}
    />
  );
}

export default function Shell({ children }) {
  const { pathname } = useLocation();
  const landing = pathname === "/";

  const tabs = [
    // Named for the role, not the noun: "Ask" alone does not tell you that it
    // is the other person's screen.
    { to: "/vault", label: "My vault", hint: "owner" },
    { to: "/ask", label: "Asked of me", hint: "verifier" },
    { to: "/ledger", label: "Ledger", hint: "owner" },
  ];

  return (
    <>
      <header className="sticky top-4 z-50 px-5 pt-4">
        <div className="mx-auto flex max-w-[1180px] items-center gap-5 rounded-lg border-[1.6px] border-ink bg-cream py-[10px] pl-5 pr-[10px]">
          <Link to="/" className="flex items-center gap-2 text-[1.0625rem] font-bold tracking-[-0.02em]">
            <Mark />
            AskOnly
          </Link>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {tabs.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className={clsx(
                  "relative rounded-[8px] px-3 py-1.5 text-[0.875rem] font-medium transition-colors",
                  pathname === t.to ? "text-ink" : "text-ink-50 hover:text-ink",
                )}
              >
                {pathname === t.to && (
                  <motion.span
                    layoutId="tab"
                    className="absolute inset-0 rounded-[8px] bg-cream-2"
                    transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </Link>
            ))}
          </nav>

          <div className={clsx("flex items-center gap-3", landing && "ml-auto md:ml-0")}>
            <ChainDot />
            <ConnectButton />
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </>
  );
}
