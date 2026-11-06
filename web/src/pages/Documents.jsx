import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "motion/react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import { api, TYPES, STATEMENTS } from "../lib/askonly.js";
import { grantsQuery, useAnswering } from "../lib/answering.jsx";
import { useSessions } from "../lib/session.js";
import ConnectButton from "../components/ConnectButton.jsx";
import DocumentTile from "../components/DocumentTile.jsx";
import SealSheet from "../components/SealSheet.jsx";
import IssueSheet from "../components/IssueSheet.jsx";
import OpenDoc from "../components/OpenDoc.jsx";
import ForgetDoc from "../components/ForgetDoc.jsx";
import { SealedPaper } from "../components/Paper.jsx";
import { PageHead, Rise, useNow } from "../components/ui.jsx";

/** Connect first. Your address is your identity here. */
export function Gate({ title, body }) {
  return (
    <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-8 sm:py-10">
      <Rise>
        <section className="tile-forest flex min-h-[440px] flex-col justify-end p-8 sm:p-10">
          <SealedPaper className="pointer-events-none absolute right-10 top-[-24px] hidden rotate-[6deg] md:block" />
          <div className="relative max-w-[28rem]">
            <h1 className="text-[clamp(2.5rem,2rem+2vw,3.5rem)] leading-[1.02]">{title}</h1>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-on-forest-2">{body}</p>
            <div className="mt-6"><ConnectButton size="lg" tone="dark" /></div>
          </div>
        </section>
      </Rise>
    </div>
  );
}

const FILL = { 1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3" };

export default function Documents() {
  const { address, isConnected } = useAccount();
  const { signAndSend } = useSessions();
  const qc = useQueryClient();
  const answering = useAnswering();
  const now = useNow(5000);

  const [seal, setSeal] = useState(null); // {} or { label, text } for a new version
  const [issue, setIssue] = useState(null); // { vaultId, pass }
  const [reading, setReading] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["vaults", address],
    queryFn: () => api(`/api/vaults?owner=${address}`),
    enabled: isConnected,
  });
  const { data: grantData } = useQuery({ ...grantsQuery(address), enabled: isConnected, refetchInterval: 15_000 });

  const vaults = useMemo(() => docs?.vaults ?? [], [docs]);
  const live = (grantData?.grants ?? []).filter(
    (g) => g.state === "live" && g.diesAt > now,
  );
  const reviewersOf = (vaultId) => live.filter((g) => g.vaultId === vaultId);

  /* Consequential documents first, so a wide tile is never stranded after a narrow one
   * and no hole opens in the grid. */
  const ordered = useMemo(
    () =>
      [...vaults].sort(
        (a, b) =>
          (reviewersOf(b.vaultId).length ? 1 : 0) - (reviewersOf(a.vaultId).length ? 1 : 0) ||
          b.createdAt - a.createdAt,
      ),
    [vaults, grantData, now], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const used = ordered.reduce((n, v) => n + (reviewersOf(v.vaultId).length ? 2 : 1), 0);
  const addColumns = 3 - (used % 3);

  /**
   * The owner signs the vaultId, and the server checks it against the owner recorded ON
   * THE VAULT before it writes. It will pay the gas to delete your document; it cannot
   * choose whose, and it cannot invent one.
   */
  async function remove(d) {
    setBusy(true);
    try {
      await signAndSend(
        { types: { Forget: TYPES.Forget }, primaryType: "Forget", message: { vaultId: d.vaultId, statement: STATEMENTS.forget } },
        ({ sig, session }) => api("/api/vault/forget", { body: { vaultId: d.vaultId, owner: address, ownerSig: sig, session } }),
      );
      answering.stop(d.vaultId);
      toast.success(`${d.label} is deleted`);
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["vaults", address] });
      qc.invalidateQueries({ queryKey: ["grants", address] });
      qc.invalidateQueries({ queryKey: ["inbox", address] });
    } catch (err) {
      toast.error(err.shortMessage ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <Gate
        title={<>Your vault opens <span className="italic">with your wallet.</span></>}
        body="Your address is your identity here. Your documents belong to it, not to us."
      />
    );
  }

  const empty = !isLoading && vaults.length === 0;

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-8 sm:py-10">
      {empty ? (
        <Rise>
          <section className="tile-forest flex min-h-[440px] flex-col justify-end p-8 sm:p-10">
            <SealedPaper className="pointer-events-none absolute right-10 top-[-24px] hidden rotate-[6deg] md:block" />
            <div className="relative max-w-[28rem]">
              <h1 className="text-[clamp(2.5rem,2rem+2vw,3.5rem)] leading-[1.02]">
                Seal your <span className="italic">first document.</span>
              </h1>
              <p className="mt-4 text-[0.9375rem] leading-relaxed text-on-forest-2">
                It locks in this browser before anything leaves. After that, people can ask about it and
                never see it.
              </p>
              <button className="btn btn-mint btn-lg mt-6" onClick={() => setSeal({})}>Seal a document</button>
            </div>
          </section>
        </Rise>
      ) : (
        <>
          <PageHead
            kicker="AskOnly / your vault"
            title="Documents"
            lead="Encrypted in your browser before they leave. Opening one takes your passphrase."
          >
            <button className="btn btn-primary" onClick={() => setSeal({})}>
              <Plus size={16} strokeWidth={1.75} /> Seal a document
            </button>
          </PageHead>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {ordered.map((v) => (
                <DocumentTile
                  key={v.vaultId}
                  doc={v}
                  reviewers={reviewersOf(v.vaultId)}
                  onAdd={(d) => setIssue({ vaultId: d.vaultId })}
                  onRead={setReading}
                  onDelete={setDeleting}
                />
              ))}
            </AnimatePresence>
            {addColumns < 3 && (
              <button
                onClick={() => setSeal({})}
                className={clsx(
                  "flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-line-2 text-ink-50 transition-colors hover:border-ink-50 hover:bg-paper hover:text-ink",
                  FILL[addColumns],
                )}
              >
                <Plus size={18} strokeWidth={1.75} />
                <span className="text-[0.875rem] font-medium">Seal another</span>
              </button>
            )}
          </div>
        </>
      )}

      <SealSheet
        open={Boolean(seal)}
        initial={seal?.text ? seal : null}
        onClose={() => setSeal(null)}
        // Sealing is only ever a step towards letting someone ask, so that comes next,
        // and the passphrase they just typed carries over rather than being asked for twice.
        onSealed={(vaultId, pass) => setIssue({ vaultId, pass })}
      />
      <IssueSheet
        open={Boolean(issue)}
        initialVaultId={issue?.vaultId}
        presetPass={issue?.pass}
        vaults={vaults}
        onClose={() => setIssue(null)}
      />
      <OpenDoc
        doc={reading}
        onClose={() => setReading(null)}
        onNewVersion={(next) => {
          setReading(null);
          setSeal(next);
        }}
      />
      <ForgetDoc
        doc={deleting}
        askers={deleting ? reviewersOf(deleting.vaultId) : []}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}
