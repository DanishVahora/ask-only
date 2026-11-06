import { Link, useLocation } from "react-router-dom";

import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";

import clsx from "clsx";
import { api } from "../lib/askonly.js";
import ConnectButton from "./ConnectButton.jsx";

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
    // That page is where YOU ask someone else. "Asked of me" said the opposite
    // of the page's own heading.
    { to: "/ask", label: "Ask someone", hint: "verifier" },
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
