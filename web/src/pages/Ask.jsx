import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, Clock, Cpu } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import { api, sha256hex, DOMAIN, TYPES, STATEMENTS, short } from "../lib/askonly.js";
import { ConnectButton } from "../components/Shell.jsx";
import Countdown from "../components/Countdown.jsx";

/**
 * The verifier's screen.
 *
 * Note what is NOT here: any prompt for the owner's passphrase. The verifier
 * cannot decrypt anything, so they cannot produce an answer — they sign a
 * request and wait for the owner's device. That waiting is the protocol
 * working, not a missing feature.
 */
export default function Ask() {
  const [params] = useSearchParams();
  const grantId = params.get("grant");
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();

  const [requestId, setRequestId] = useState(() => sessionStorage.getItem(`req:${grantId}`) || null);
  const [busy, setBusy] = useState(false);

  const { data: grant, error: grantErr } = useQuery({
    queryKey: ["grant", grantId],
    queryFn: () => api(`/api/grant?id=${grantId}`),
    enabled: Boolean(grantId),
    retry: false,
  });

  const { data: req } = useQuery({
    queryKey: ["request", requestId],
    queryFn: () => api(`/api/request?id=${requestId}`),
    enabled: Boolean(requestId),
    refetchInterval: (q) => (q.state.data?.state === "pending" ? 3000 : false),
    retry: false,
  });

  const { data: providers } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api("/api/providers"),
    staleTime: 60_000,
  });

  async function ask() {
    setBusy(true);
    try {
      const questionHash = await sha256hex(grant.note);
      const askedAt = Date.now();
      // Signed BEFORE being told anything. You cannot learn the answer without
      // leaving a record that you asked.
      const askerSig = await signTypedDataAsync({
        domain: DOMAIN, types: { Request: TYPES.Request }, primaryType: "Request",
        message: { grantId, questionHash, askedAt: BigInt(askedAt), statement: STATEMENTS.request },
      });
      const res = await api("/api/request", {
        body: { grantId, questionHash, askedAt, asker: address, askerSig },
      });
      sessionStorage.setItem(`req:${grantId}`, res.requestId);
      setRequestId(res.requestId);
      toast.success("Sent. Only the owner's device can answer it.");
      qc.invalidateQueries({ queryKey: ["request"] });
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!grantId) {
    return (
      <Centered title="No permission in this link.">
        Ask whoever sent you here for a link that carries one.
      </Centered>
    );
  }
  if (grantErr?.status === 404) {
    return (
      <Centered title={<>This permission <span className="italic">no longer exists.</span></>}>
        Past its death block the network stops returning it and every operation on it fails.
        There was nothing to revoke and nothing to delete.
      </Centered>
    );
  }
  if (!grant) return <Centered title="Loading…" />;

  const receipt = req?.receipt;
  const state = req?.state;

  return (
    <div className="mx-auto max-w-[760px] px-5 pb-28 pt-10">
      <p className="eyebrow">Verifier</p>
      <h1 className="mt-3 text-[clamp(1.75rem,1.3rem+1.8vw,2.5rem)]">
        You may ask one question.<br />
        <span className="italic">You will never hold the document.</span>
      </h1>

      <div className="mt-8 rounded-xl border-[1.6px] border-ink bg-paper p-6">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-[0.875rem]">{grant.grantId}</span>
          <span className={clsx("tag", grant.state === "live" ? "tag-on" : "tag-stop")}>{grant.state}</span>
        </div>

        <p className="mt-5 font-serif text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] leading-tight tracking-[-0.025em]">
          “{grant.note}”
        </p>

        <div className="mt-5 grid gap-x-8 gap-y-2 text-[0.8125rem] sm:grid-cols-2">
          <Row k="Issued to" v={`${grant.verifierName || ""} ${short(grant.verifier, 8, 6)}`} />
          <Row k="Uses" v={`${grant.usesSpent} of ${grant.usesAllowed}`} />
        </div>
        <Countdown diesAt={grant.diesAt} className="mt-4" />

        <div className="mt-6 border-t border-line pt-5">
          {!isConnected ? (
            <div className="flex flex-wrap items-center gap-4">
              <ConnectButton size="lg" />
              <p className="text-[0.8125rem] text-ink-50">
                Connect to ask. Your signature is what records that you asked.
              </p>
            </div>
          ) : !requestId ? (
            <button className="btn btn-primary" onClick={ask} disabled={busy || grant.state !== "live"}>
              {busy ? "Check your wallet…" : "Sign & ask"}
            </button>
          ) : (
            <AnimatePresence mode="wait">
              {state === "pending" && (
                <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="flex items-center gap-3">
                  <span className="h-[7px] w-[7px] rounded-full bg-[#7a5312] breathe" />
                  <div>
                    <p className="text-[0.9375rem] font-semibold">Waiting on the owner's device</p>
                    <p className="mt-0.5 text-[0.8125rem] text-ink-50">
                      Only they can decrypt it. You cannot, and neither can this site.
                    </p>
                  </div>
                </motion.div>
              )}
              {state === "refused" && (
                <motion.div key="refused" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                  <p className="font-serif text-[2.5rem] leading-none tracking-[-0.03em] text-clay">Declined</p>
                  <p className="mt-2 text-[0.8125rem] text-ink-50">
                    The owner saw the request and declined. You were told nothing about the document.
                  </p>
                </motion.div>
              )}
              {state === "answered" && receipt && (
                <motion.div key="answered" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", bounce: 0.3, duration: 0.5 }}>
                  <p className={clsx(
                    "font-serif text-[3.5rem] leading-none tracking-[-0.03em]",
                    receipt.answer === "yes" ? "text-seal" : receipt.answer === "no" ? "text-clay" : "text-ink-50",
                  )}>
                    {receipt.answer.toUpperCase()}
                  </p>
                  {receipt.band && <p className="mt-2 text-[0.9375rem] text-ink-70">{receipt.band}</p>}

                  <div className="mt-6 grid gap-x-8 gap-y-2 border-t border-line pt-5 text-[0.75rem] sm:grid-cols-2">
                    <Row k="Request id" v={receipt.requestId || "—"} mono />
                    <Row k="Enclave" v={short(receipt.provider, 10, 6)} mono />
                    <Row k="Verified by" v={receipt.verification} mono />
                    <Row k="Took" v={`${receipt.latencyMs} ms`} mono />
                  </div>
                  <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-50">
                    This is the whole of what you received. No document, no key, no figures.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* who answered — the argument for pinning, made from live data */}
      {providers?.configured && (
        <div className="mt-6 rounded-xl border border-line bg-cream-2 p-6">
          <div className="mb-4 flex items-center gap-2">
            <Cpu size={15} className="text-ink-50" />
            <p className="eyebrow !mb-0">Who can answer</p>
          </div>
          <div className="space-y-2">
            {providers.providers.map((p) => (
              <div key={p.address} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                <span className={clsx("tag", p.verifiability === "TeeML" ? "tag-on" : "tag-stop")}>
                  {p.verifiability === "TeeML" ? "enclave" : "no enclave"}
                </span>
                <span className="flex-1 text-[0.875rem]">{p.name}</span>
                <span className="font-mono text-[0.75rem] text-ink-50">
                  {p.verifiability === "TeeML" ? `${p.teeType}/${p.teeVerifier}` : "—"}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-50">
            The same model is served by providers with no enclave at all. AskOnly refuses them, and
            discards an answer that comes back from one.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 last:border-0">
      <span className="shrink-0 text-ink-50">{k}</span>
      <span className={clsx("truncate text-right", mono && "font-mono tnum")}>{v}</span>
    </div>
  );
}

function Centered({ title, children }) {
  return (
    <div className="mx-auto max-w-[520px] px-5 py-28 text-center">
      <h1 className="text-[clamp(1.75rem,1.3rem+1.8vw,2.5rem)]">{title}</h1>
      {children && <p className="mx-auto mt-5 max-w-[42ch] text-[0.9375rem] leading-relaxed text-ink-70">{children}</p>}
    </div>
  );
}
