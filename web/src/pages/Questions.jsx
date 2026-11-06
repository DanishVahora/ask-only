import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Loader2 } from "lucide-react";

import { api, short, timeAgo } from "../lib/askonly.js";
import { grantsQuery, inboxQuery, useAnswering } from "../lib/answering.jsx";
import { PageHead, Rise, Stamp } from "../components/ui.jsx";
import { Gate } from "./Documents.jsx";

/** Plain words for what the enclave was given. */
function seenText(linesSeen, verification) {
  if (verification === "no-lines-matched") return "Nothing was sent to the enclave";
  const m = String(linesSeen ?? "").match(/^(\d+)\/(\d+)$/);
  if (!m) return null;
  return m[1] === m[2] ? "The enclave read the whole document" : `The enclave read ${m[1]} of ${m[2]} lines`;
}

function Row({ who, at, about, question, detail, stamp, children }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="border-t border-line px-6 py-4 first:border-t-0"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] text-ink-50">
            <span className="font-medium text-ink-70">{who}</span>
            {" · "}
            {timeAgo(at)}
            {about ? ` · ${about}` : ""}
          </p>
          <p className="mt-1 break-words font-serif text-[1.25rem] leading-[1.25] tracking-[-0.012em]">“{question}”</p>
          {detail && <p className="mt-1 text-[0.8125rem] leading-snug text-ink-50">{detail}</p>}
        </div>
        {stamp}
      </div>
      {children}
    </motion.li>
  );
}

/**
 * Everything that has been asked, and what went back. A record to read if you want to,
 * and never a queue to work through: answering happens by itself.
 */
export default function Questions() {
  const { address, isConnected } = useAccount();
  const { answers, rows, retry } = useAnswering();

  const { data: docs } = useQuery({
    queryKey: ["vaults", address],
    queryFn: () => api(`/api/vaults?owner=${address}`),
    enabled: isConnected,
  });
  const { data: inbox } = useQuery({ ...inboxQuery(address), enabled: isConnected, refetchInterval: 4000 });
  const { data: grantData } = useQuery({ ...grantsQuery(address), enabled: isConnected, refetchInterval: 15_000 });
  const { data } = useQuery({
    queryKey: ["ledger", address],
    queryFn: () => api(`/api/accesses?owner=${address}`),
    enabled: isConnected,
    refetchInterval: 8000,
  });

  if (!isConnected) {
    return (
      <Gate
        title={<>Everything you&rsquo;ve been asked, <span className="italic">in one place.</span></>}
        body="Connect the wallet that owns your documents."
      />
    );
  }

  const labelOf = (vaultId) => (docs?.vaults ?? []).find((v) => v.vaultId === vaultId)?.label ?? "";
  const pending = [...(inbox?.pending ?? [])].sort((a, b) => a.askedAt - b.askedAt);
  const canAnswer = (r) => {
    const g = (grantData?.grants ?? []).find((x) => x.grantId === r.grantId);
    return Boolean(g) && answers(g);
  };
  const locked = pending.filter((r) => !canAnswer(r)).length;
  const done = [
    ...(data?.accesses ?? []).map((a) => ({ kind: "answered", at: a.at, a })),
    ...(data?.refusals ?? []).map((r) => ({ kind: "refused", at: r.at, r })),
  ].sort((x, y) => y.at - x.at);

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-8 sm:py-10">
      <PageHead kicker="AskOnly / the record" title="Questions" lead="Everything you've been asked, and what went back. Answering happens by itself." />

      {locked > 0 && (
        <Rise className="mb-4">
          <div className="tile flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-[0.9375rem]">
              {locked} {locked === 1 ? "question is" : "questions are"} waiting for this browser to be unlocked.
            </p>
            <Link className="btn btn-sm" to="/reviewers">Unlock</Link>
          </div>
        </Rise>
      )}

      <Rise i={1}>
        <section className="tile">
          {pending.length + done.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-serif text-[1.5rem] leading-[1.2] tracking-[-0.015em]">Nothing asked yet</p>
              <p className="mx-auto mt-2 max-w-[42ch] text-[0.9375rem] leading-relaxed text-ink-50">
                When a reviewer asks something, your browser answers it and it shows up here.
              </p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              <AnimatePresence initial={false}>
                {pending.map((r) => {
                  const row = rows[r.requestId];
                  const failed = row?.state === "failed";
                  return (
                    <Row
                      key={r.requestId}
                      who={r.askerName || short(r.asker, 8, 4)}
                      at={r.askedAt}
                      about={labelOf(r.vaultId)}
                      question={r.question}
                      stamp={
                        canAnswer(r) && !failed ? (
                          <span className="tag tag-on shrink-0">
                            <Loader2 size={11} className="animate-spin" /> Answering
                          </span>
                        ) : (
                          <Stamp answer="waiting" />
                        )
                      }
                    >
                      {failed && (
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <p className="min-w-0 text-[0.8125rem] leading-snug text-clay">{row.detail}</p>
                          <button className="btn btn-sm" onClick={() => retry(r.requestId)}>Try again</button>
                        </div>
                      )}
                    </Row>
                  );
                })}
                {done.map(({ kind, a, r }) =>
                  kind === "answered" ? (
                    <Row
                      key={a.accessId}
                      who={a.askerName || short(a.asker, 8, 4)}
                      at={a.at}
                      question={a.question}
                      detail={[a.band, seenText(a.linesSeen, a.verification)].filter(Boolean).join(". ")}
                      stamp={<Stamp answer={a.answer} />}
                    />
                  ) : (
                    <Row
                      key={r.refusalId}
                      who={(grantData?.grants ?? []).find((g) => g.grantId === r.grantId)?.verifierName || short(r.asker, 8, 4)}
                      at={r.at}
                      question={r.question}
                      detail={r.reason === "out-of-scope" ? "Outside what you allowed, so it was turned down" : null}
                      stamp={<Stamp answer="refused" />}
                    />
                  ),
                )}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </Rise>
    </div>
  );
}
