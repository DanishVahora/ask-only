import { Fragment, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import { api, remaining, short, TYPES, STATEMENTS } from "../lib/askonly.js";
import { ANY_TOPIC } from "../lib/questions.js";
import { grantsQuery, inboxQuery, useAnswering } from "../lib/answering.jsx";
import { useSessions } from "../lib/session.js";
import IssueSheet from "../components/IssueSheet.jsx";
import UnlockSheet from "../components/UnlockSheet.jsx";
import { PageHead, Perf, Rise, useNow } from "../components/ui.jsx";
import { Gate } from "./Documents.jsx";

/** One person's permission, as a stub in a book of tickets. */
function Stub({ grant, label, waiting, answers, onUnlock, onEnd, ending }) {
  const [copied, setCopied] = useState(false);
  useNow(1000);
  const r = remaining(grant.diesAt);
  const dying = r.ms < 60_000;
  // The bar only exists in the last ten minutes. A 7-day permission should not look the
  // same as a 2-minute one for six days.
  const finalStretch = r.ms <= 600_000;
  const limited = grant.note && grant.note !== ANY_TOPIC;
  const link = `${location.origin}/ask?grant=${grant.grantId}`;

  return (
    <div className="px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 truncate font-serif text-[1.5rem] leading-[1.2] tracking-[-0.015em]">
          {grant.verifierName || short(grant.verifier, 8, 4)}
        </p>
        <span className={clsx("shrink-0 font-mono tnum text-[0.8125rem]", dying ? "text-clay" : "text-ink-70")}>
          {r.dead ? "ended" : `${r.text} left`}
        </span>
      </div>

      <p className="mt-1 text-[0.875rem] leading-snug text-ink-70">
        Can ask about <span className="font-medium text-ink">{label || "a document"}</span>
        {limited ? <>, only {grant.note}</> : null}
      </p>

      {finalStretch && !r.dead && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-line">
          {/* Transform, not width: a width transition re-fired by the 1s tick never settles. */}
          <div
            className={clsx(
              "h-full origin-left rounded-full transition-transform duration-1000 ease-linear",
              dying ? "bg-clay" : "bg-seal",
            )}
            style={{ transform: `scaleX(${Math.min(1, r.ms / 600_000)})` }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 font-mono tnum text-[0.75rem] text-ink-50">
          {short(grant.verifier, 6, 4)} · {grant.usesSpent + waiting} asked
          {!answers && <span className="tag tag-warn font-sans">Paused on this browser</span>}
        </p>
        <div className="flex items-center gap-3">
          {!answers && <button className="btn btn-sm" onClick={onUnlock}>Unlock</button>}
          <button
            className="link-action"
            onClick={() => {
              (navigator.clipboard?.writeText(link) ?? Promise.reject()).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                },
                () => toast.error(`Couldn't copy it. The link is ${link}`),
              );
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.75} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <button className="link-action link-action-danger" onClick={() => onEnd(grant)} disabled={ending}>
            {ending ? "Ending…" : "End"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Reviewers() {
  const { address, isConnected } = useAccount();
  const { signAndSend } = useSessions();
  const qc = useQueryClient();
  const answering = useAnswering();
  const now = useNow(5000);

  const [adding, setAdding] = useState(false);
  const [unlocking, setUnlocking] = useState(null);
  const [ending, setEnding] = useState(null);

  const { data: docs } = useQuery({
    queryKey: ["vaults", address],
    queryFn: () => api(`/api/vaults?owner=${address}`),
    enabled: isConnected,
  });
  const { data: grantData } = useQuery({ ...grantsQuery(address), enabled: isConnected, refetchInterval: 15_000 });
  const { data: inbox } = useQuery({ ...inboxQuery(address), enabled: isConnected, refetchInterval: 4000 });

  if (!isConnected) {
    return (
      <Gate
        title={<>See who can ask, <span className="italic">and for how long.</span></>}
        body="Connect the wallet that owns your documents."
      />
    );
  }

  const vaults = docs?.vaults ?? [];
  const grants = grantData?.grants ?? [];
  const pending = inbox?.pending ?? [];
  const isLive = (g) => g.diesAt > now && g.state === "live";
  const live = grants.filter(isLive);
  const past = grants.filter((g) => !isLive(g));
  const labelOf = (vaultId) => vaults.find((v) => v.vaultId === vaultId)?.label ?? "";
  const waitingOn = (grantId) => pending.filter((r) => r.grantId === grantId).length;

  async function end(grant) {
    setEnding(grant.grantId);
    try {
      await signAndSend(
        { types: { Revoke: TYPES.Revoke }, primaryType: "Revoke", message: { grantId: grant.grantId, statement: STATEMENTS.revoke } },
        ({ sig, session }) => api("/api/grant/revoke", { body: { grantId: grant.grantId, owner: address, ownerSig: sig, session } }),
      );
      toast(`${grant.verifierName || "They"} can't ask anything more`);
      qc.invalidateQueries({ queryKey: ["grants", address] });
      qc.invalidateQueries({ queryKey: ["inbox", address] });
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setEnding(null);
    }
  }

  const unlockDoc = unlocking ? vaults.find((v) => v.vaultId === unlocking) : null;
  const unlockUntil = unlocking
    ? Math.max(0, ...live.filter((g) => g.vaultId === unlocking).map((g) => g.diesAt))
    : 0;

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-8 sm:py-10">
      <PageHead kicker="AskOnly / who can ask" title="Reviewers" lead="Who can ask about your documents, for the time you gave them.">
        {vaults.length > 0 && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} strokeWidth={1.75} /> Add a reviewer
          </button>
        )}
      </PageHead>

      <Rise>
        <section className="tile">
          {live.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-serif text-[1.5rem] leading-[1.2] tracking-[-0.015em]">Nobody can ask right now</p>
              <p className="mx-auto mt-2 max-w-[42ch] text-[0.9375rem] leading-relaxed text-ink-50">
                {vaults.length
                  ? "Add a reviewer and they get a link that only their wallet can use."
                  : "Seal a document first, then you can let someone ask about it."}
              </p>
            </div>
          ) : (
            live.map((g, i) => (
              <Fragment key={g.grantId}>
                {i > 0 && <Perf />}
                <Stub
                  grant={g}
                  label={labelOf(g.vaultId)}
                  waiting={waitingOn(g.grantId)}
                  answers={answering.restoring || answering.answers(g)}
                  onUnlock={() => setUnlocking(g.vaultId)}
                  onEnd={end}
                  ending={ending === g.grantId}
                />
              </Fragment>
            ))
          )}
        </section>
      </Rise>

      {past.length > 0 && (
        <details className="mt-6 px-1">
          <summary className="cursor-pointer list-none text-[0.8125rem] text-ink-50 transition-colors hover:text-ink">
            {past.length} ended
          </summary>
          <ul className="m-0 mt-2 list-none p-0">
            {past.map((g) => (
              <li key={g.grantId} className="flex items-baseline gap-3 border-t border-line py-2 text-[0.8125rem] text-ink-50">
                <span className="w-[16ch] shrink-0 truncate">{g.verifierName || short(g.verifier, 6, 4)}</span>
                <span className="min-w-0 flex-1 truncate">{labelOf(g.vaultId)}</span>
                <span className="shrink-0 font-mono text-[0.75rem]">
                  {g.state === "revoked" ? "ended by you" : "ran out"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <IssueSheet open={adding} vaults={vaults} onClose={() => setAdding(false)} />
      <UnlockSheet doc={unlockDoc} diesAtMs={unlockUntil} onClose={() => setUnlocking(null)} />
    </div>
  );
}
