import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check } from "lucide-react";
import { api, short } from "../lib/askonly.js";

/**
 * Where am I, and what happens next.
 *
 * There are two people in this protocol and one of them can be you wearing a
 * different wallet, which is genuinely confusing the first time. This strip
 * answers it in place rather than in a paragraph: which role this address is
 * playing, what has already happened, and what the next action is.
 *
 * It shows real state - sealed documents, issued permissions, waiting
 * requests - so it doubles as a progress indicator rather than static help.
 */
export default function RoleGuide({ role }) {
  const { address } = useAccount();

  const { data: docs } = useQuery({
    queryKey: ["vaults", address],
    queryFn: () => api(`/api/vaults?owner=${address}`),
    enabled: Boolean(address) && role === "owner",
  });
  const { data: grants } = useQuery({
    queryKey: ["grants", address],
    queryFn: () => api(`/api/grants?owner=${address}`),
    enabled: Boolean(address) && role === "owner",
  });
  const { data: inbox } = useQuery({
    queryKey: ["inbox", address],
    queryFn: () => api(`/api/inbox?owner=${address}`),
    enabled: Boolean(address) && role === "owner",
    refetchInterval: 4000,
  });

  const sealed = (docs?.vaults ?? []).length > 0;
  const issued = (grants?.grants ?? []).length > 0;
  const waiting = (inbox?.pending ?? []).length > 0;

  const steps =
    role === "owner"
      ? [
          { k: "seal", n: "Seal a document", d: "It encrypts here. Nothing readable leaves.", done: sealed },
          { k: "issue", n: "Issue a permission", d: "Name their address. You get a link to send.", done: issued },
          { k: "they", n: "They ask", d: "Using that link, with their own wallet.", done: waiting || issued },
          { k: "you", n: "You answer", d: "Only your device can — it holds the passphrase.", done: false, now: waiting },
        ]
      : [
          { k: "connect", n: "Connect your wallet", d: "The permission names one address. It must be yours.", done: Boolean(address) },
          { k: "ask", n: "Sign & ask", d: "You sign before you are told anything.", done: false },
          { k: "wait", n: "Wait for their device", d: "You cannot decrypt the document. Nobody here can but them.", done: false },
          { k: "answer", n: "Read the answer", d: "One bit. Never the document.", done: false },
        ];

  return (
    <div className="mb-10 rounded-xl border border-line bg-cream-2 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="eyebrow !mb-0">You are the</span>
        <span className={clsx("tag", role === "owner" ? "tag-on" : "tag-warn")}>
          {role === "owner" ? "document owner" : "verifier"}
        </span>
        {address && (
          <span className="font-mono tnum text-[0.75rem] text-ink-50">{short(address, 8, 6)}</span>
        )}
        <span className="ml-auto text-[0.75rem] text-ink-50">
          {role === "owner"
            ? "The other party uses a different wallet"
            : "You will never hold the document"}
        </span>
      </div>

      <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.k}
            className={clsx(
              "rounded-[10px] border px-3.5 py-3 transition-colors",
              s.now
                ? "border-seal bg-seal-wash"
                : s.done
                  ? "border-line bg-paper"
                  : "border-dashed border-line-2",
            )}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={clsx(
                "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full font-mono text-[0.625rem]",
                s.done ? "bg-seal text-white" : s.now ? "bg-seal text-white" : "border border-line-2 text-ink-50",
              )}>
                {s.done ? <Check size={11} /> : i + 1}
              </span>
              <span className="text-[0.8125rem] font-semibold leading-tight">{s.n}</span>
            </div>
            <p className="text-[0.75rem] leading-snug text-ink-50">{s.d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
