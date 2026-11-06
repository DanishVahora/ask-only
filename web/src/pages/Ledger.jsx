import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { Check, X, Radio } from "lucide-react";
import clsx from "clsx";

import { api, short, timeAgo } from "../lib/askonly.js";
import ConnectButton from "../components/ConnectButton.jsx";

export default function Ledger() {
  const { address, isConnected } = useAccount();

  const { data } = useQuery({
    queryKey: ["ledger", address],
    queryFn: () => api(`/api/accesses?owner=${address}`),
    enabled: isConnected,
    refetchInterval: 10_000,
  });
  const { data: ret } = useQuery({
    queryKey: ["retention"],
    queryFn: () => api("/api/retention"),
    refetchInterval: 6000,
  });

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-28 text-center">
        <h1 className="text-[clamp(2rem,1.4rem+2.2vw,3rem)]">
          Who asked <span className="italic">about you.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[38ch] text-[0.9375rem] leading-relaxed text-ink-70">
          Connect the wallet that owns the documents.
        </p>
        <div className="mt-8 flex justify-center"><ConnectButton size="lg" /></div>
      </div>
    );
  }

  const accesses = data?.accesses ?? [];
  const refusals = data?.refusals ?? [];

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-28 pt-10">
      <h1 className="text-[clamp(1.75rem,1.3rem+1.8vw,2.5rem)]">
        Who asked <span className="italic">about you.</span>
      </h1>

      <div className="mt-10 grid gap-10 md:grid-cols-[1.4fr_1fr]">
        <div className="space-y-10">
          <section>
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <h2 className="font-sans text-[1.0625rem] font-semibold tracking-[-0.015em]">Answered</h2>
              <span className="tag">{accesses.length}</span>
            </div>
            {accesses.length ? (
              <div className="space-y-1">
                {accesses.map((a) => (
                  <div key={a.accessId} className="grid grid-cols-[64px_1fr_auto] items-start gap-4 border-b border-line py-3 last:border-0">
                    <span className="font-mono tnum text-[0.75rem] text-ink-50">{timeAgo(a.at)}</span>
                    <div className="min-w-0">
                      <p className="text-[0.875rem]">
                        {a.askerName || short(a.asker, 8, 4)} asked “{a.question}”
                      </p>
                      <p className="mt-1 font-mono text-[0.75rem] text-ink-50">
                        req {a.requestId ? short(a.requestId, 8, 4) : "—"} · {a.teeType || "—"} · {a.verification} · {a.latencyMs}ms
                      </p>
                    </div>
                    <span className={clsx("tag", a.answer === "yes" ? "tag-on" : a.answer === "no" ? "tag-stop" : "")}>
                      {a.answer}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty t="Nothing yet" d="Nobody has asked about your documents." />
            )}
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <h2 className="font-sans text-[1.0625rem] font-semibold tracking-[-0.015em]">Refused</h2>
              <span className="tag">{refusals.length}</span>
            </div>
            {refusals.length ? (
              <div className="space-y-1">
                {refusals.map((r) => (
                  <div key={r.refusalId} className="grid grid-cols-[64px_1fr_auto] items-start gap-4 border-b border-line py-3 last:border-0">
                    <span className="font-mono tnum text-[0.75rem] text-ink-50">{timeAgo(r.at)}</span>
                    <div className="min-w-0">
                      <p className="text-[0.875rem]">{short(r.asker, 8, 4)} tried to ask “{r.question}”</p>
                      {r.detail && <p className="mt-1 text-[0.75rem] text-ink-50">{r.detail}</p>}
                    </div>
                    <span className="tag tag-stop">{r.reason}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty t="Nothing refused" d="No one has tried to ask something they were not permitted to." />
            )}
          </section>
        </div>

        {/* retention */}
        <aside>
          <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
            <Radio size={15} className="text-ink-50" />
            <h2 className="font-sans text-[1.0625rem] font-semibold tracking-[-0.015em]">Retention</h2>
          </div>

          <div className="rounded-xl border-[1.6px] border-ink bg-forest p-5 text-on-forest">
            <p className="font-serif text-[1.25rem] leading-snug tracking-[-0.02em]">
              Extension leaves a mark. <span className="italic">Death does not.</span>
            </p>
            <div className="mt-5 space-y-2 font-mono tnum text-[0.8125rem] text-on-forest-2">
              <Stat k="seen chain-wide" v={ret?.seen ?? 0} />
              <Stat k="yours" v={ret?.kept ?? 0} />
              <Stat k="strangers' (dropped)" v={ret?.dropped ?? 0} />
            </div>
            <p className="mt-5 text-[0.75rem] leading-relaxed text-on-forest-2">
              {ret?.statement ??
                "Arkiv emits an event when a record is extended and nothing when one expires."}
            </p>
          </div>

          <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-50">
            The event stream is chain-wide, with no owner filter. Everything above is filtered to
            your wallet — which is why it is trustworthy, and why an unfiltered monitor would not be.
          </p>
        </aside>
      </div>
    </div>
  );
}

const Stat = ({ k, v }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-[rgba(244,243,220,0.16)] pb-2 last:border-0">
    <span>{k}</span>
    <span className="text-[1.125rem] text-on-forest">{v}</span>
  </div>
);

const Empty = ({ t, d }) => (
  <div className="rounded-[12px] border border-dashed border-line-2 px-5 py-10 text-center">
    <p className="text-[0.9375rem]">{t}</p>
    <p className="mx-auto mt-1.5 max-w-[34ch] text-[0.8125rem] text-ink-50">{d}</p>
  </div>
);
