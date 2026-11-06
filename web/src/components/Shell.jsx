import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { KeyRound, LockKeyhole } from "lucide-react";
import clsx from "clsx";

import { api } from "../lib/askonly.js";
import { grantsQuery, inboxQuery, useAnswering } from "../lib/answering.jsx";
import ConnectButton from "./ConnectButton.jsx";
import KeySheet from "./KeySheet.jsx";
import Mark from "./Mark.jsx";

/* What this page needs from the API. A stale server looks exactly like a bug in
 * whatever you happen to be looking at, and cost an evening before anything said so. */
const NEEDS_API_BUILD = 7;

const OWN = [
  { to: "/documents", label: "Documents" },
  { to: "/reviewers", label: "Reviewers" },
  { to: "/questions", label: "Questions" },
];
const THEIRS = [{ to: "/shared", label: "Shared with me", also: ["/ask"] }];

/** A page, and the highlighter that marks the one you're on. It slides to the next. */
function Tab({ item, pathname, count, attention, id }) {
  const on = pathname === item.to || item.also?.includes(pathname);
  return (
    <Link to={item.to} aria-current={on ? "page" : undefined} className={clsx("app-tab", on && "is-on")}>
      {on && (
        <motion.span layoutId={id} className="app-tab-mark" transition={{ type: "spring", bounce: 0.12, duration: 0.42 }} />
      )}
      <span className="relative">{item.label}</span>
      {attention > 0 ? (
        <span className="app-tab-alert tnum" title={`${attention} waiting for this browser`}>
          {attention}
        </span>
      ) : (
        count > 0 && <span className="app-tab-count tnum">{count}</span>
      )}
    </Link>
  );
}

function Tabs({ pathname, counts, waitingLocked, id, className }) {
  return (
    <nav aria-label="AskOnly" className={clsx("app-tabs", className)}>
      {OWN.map((item) => (
        <Tab
          key={item.to}
          item={item}
          pathname={pathname}
          id={id}
          count={counts[item.to]}
          attention={item.to === "/reviewers" ? waitingLocked : 0}
        />
      ))}
      <span className="app-tabs-gap" aria-hidden />
      {THEIRS.map((item) => (
        <Tab key={item.to} item={item} pathname={pathname} id={id} count={counts[item.to]} />
      ))}
    </nav>
  );
}

/** What is true right now, in a word, always in view. */
function Status({ address, waitingLocked }) {
  const { sessions, restoring, hasKey, keyProblem } = useAnswering();
  const [keyOpen, setKeyOpen] = useState(false);
  if (!address || restoring) return null;
  // Saying "Answering" while every question fails for want of a key was the old behaviour.
  if (sessions.length > 0 && (!hasKey || keyProblem)) {
    return (
      <>
        <button
          type="button"
          className="app-status is-waiting"
          onClick={() => setKeyOpen(true)}
          title={keyProblem ?? "Add your 0G key to keep answering"}
        >
          <KeyRound size={13} strokeWidth={2} />
          Add 0G key
        </button>
        <KeySheet open={keyOpen} onClose={() => setKeyOpen(false)} />
      </>
    );
  }
  if (waitingLocked > 0) {
    return (
      <Link to="/reviewers" className="app-status is-waiting" title="Unlock this browser to answer">
        <LockKeyhole size={13} strokeWidth={2} />
        {waitingLocked} waiting
      </Link>
    );
  }
  if (sessions.length === 0) return null;
  return (
    <span className="app-status" title="Answering by itself. Keep a tab open, even in the background.">
      <i className="breathe" />
      Answering
    </span>
  );
}

export default function Shell({ children }) {
  const { pathname } = useLocation();
  const { address, isConnected } = useAccount();
  const { answers } = useAnswering();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const { data: health, isFetched } = useQuery({
    queryKey: ["health"],
    queryFn: () => api("/api/health"),
    refetchInterval: 20_000,
  });
  const { data: docs } = useQuery({
    queryKey: ["vaults", address],
    queryFn: () => api(`/api/vaults?owner=${address}`),
    enabled: isConnected,
  });
  const { data: grants } = useQuery({ ...grantsQuery(address), enabled: isConnected, refetchInterval: 15_000 });
  const { data: inbox } = useQuery({ ...inboxQuery(address), enabled: isConnected, refetchInterval: 4000 });
  const { data: ledger } = useQuery({
    queryKey: ["ledger", address],
    queryFn: () => api(`/api/accesses?owner=${address}`),
    enabled: isConnected,
    refetchInterval: 10_000,
  });
  const { data: given } = useQuery({
    queryKey: ["given", address],
    queryFn: () => api(`/api/grants?verifier=${address}`),
    enabled: isConnected,
    refetchInterval: 15_000,
  });

  const stale = import.meta.env.DEV && isFetched && health && health.build !== NEEDS_API_BUILD;

  // The landing page is a page about the product, not a screen in it.
  if (pathname === "/") return children;

  const now = Date.now();
  const alive = (g) => g.state === "live" && g.diesAt > now;
  const counts = {
    "/documents": docs?.vaults?.length ?? 0,
    "/reviewers": (grants?.grants ?? []).filter(alive).length,
    "/questions": (ledger?.accesses?.length ?? 0) + (ledger?.refusals?.length ?? 0),
    "/shared": (given?.grants ?? []).filter(alive).length,
  };
  // A document can be open here and still not answer, if the permission names a key
  // from another browser. What counts is whether this tab can answer this question.
  const waitingLocked = (inbox?.pending ?? []).filter((r) => {
    const g = (grants?.grants ?? []).find((x) => x.grantId === r.grantId);
    return !g || !answers(g);
  }).length;

  return (
    <div className="min-h-dvh">
      {stale && (
        <div className="bg-clay px-4 py-2 text-center text-[0.8125rem] font-medium text-white">
          The API is running older code than this page. Stop <code className="font-mono">npm start</code> and run it again.
        </div>
      )}

      {/* The same strip of paper as the landing page's nav. A tear line appears once
          there is something underneath it. */}
      <header className={clsx("app-bar", scrolled && "is-scrolled")}>
        <div className="app-bar-in">
          <Link to="/" className="app-logo">
            <Mark size={20} />
            AskOnly
          </Link>
          <Tabs pathname={pathname} counts={counts} waitingLocked={waitingLocked} id="tab" className="app-tabs-wide" />
          <div className="app-bar-end">
            <Status address={address} waitingLocked={waitingLocked} />
            <span
              title={health?.ok ? `sepolia ${health.chain.block} · arkiv ${health.arkiv.block}` : "Connecting"}
              className={clsx("app-dot", health?.ok && "is-ok")}
            />
            <ConnectButton />
          </div>
        </div>
        {/* Below 1024px the pages get a row of their own, and it never disappears. */}
        <Tabs pathname={pathname} counts={counts} waitingLocked={waitingLocked} id="tab-row" className="app-tabs-row" />
      </header>

      {/* A fade only, and no exit: waiting for one page to leave before the next could
          arrive made every click cost half a second. */}
      <motion.main key={pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.16 }}>
        {children}
      </motion.main>
    </div>
  );
}
