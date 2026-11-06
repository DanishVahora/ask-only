import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Lock, FileText, FileType, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { api, encryptDocument, DOMAIN, TYPES, STATEMENTS, short } from "../lib/askonly.js";
import { TOPICS } from "../lib/questions.js";
import ConnectButton from "../components/ConnectButton.jsx";
import Inbox from "../components/Inbox.jsx";
import Sheet from "../components/Sheet.jsx";
import DropDoc from "../components/DropDoc.jsx";
import PermissionTicket from "../components/PermissionTicket.jsx";

/* ------------------------------------------------------------------ gate -- */

function Gate() {
  return (
    <div className="mx-auto max-w-[680px] px-5 py-24">
      <div className="text-center">
        <h1 className="text-[clamp(2rem,1.4rem+2.2vw,3rem)]">
          Connect a wallet to open <span className="italic">your</span> vault.
        </h1>
        <p className="mx-auto mt-5 max-w-[40ch] text-[0.9375rem] leading-relaxed text-ink-70">
          Your address is your identity here. Documents and permissions belong to it, not to us.
        </p>
        <div className="mt-8 flex justify-center">
          <ConnectButton size="lg" />
        </div>
      </div>

      {/* Two people, stated as prose rather than as two matching boxes. */}
      <div className="mt-20 border-t border-line pt-10">
        <p className="eyebrow text-center">There are two people in this</p>
        <div className="mt-8 grid gap-10 sm:grid-cols-2">
          <div>
            <p className="font-serif text-[1.375rem] tracking-[-0.02em]">You</p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-70">
              Seal a document, issue someone a single question, and answer it when they ask.
              Only your device holds the passphrase.
            </p>
          </div>
          <div>
            <p className="font-serif text-[1.375rem] tracking-[-0.02em]">
              Them <span className="italic text-ink-50">— the link you send</span>
            </p>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-70">
              They open it with their own wallet, sign, and ask. Then they wait — they cannot
              answer it themselves, and neither can we.
            </p>
          </div>
        </div>
        <p className="mt-10 text-center text-[0.8125rem] text-ink-50">
          Trying it alone? Add a second account in your wallet and issue the permission to that address.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page -- */

// docKind is payslip | bank | rent | identity | other - the pdf/image kind
// from DropDoc is never persisted, so keying on it rendered one icon per row.
const KIND_ICON = {
  payslip: FileText, bank: FileType, rent: FileType, identity: ImageIcon, other: FileText,
};

export default function Vault() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();

  const [sheet, setSheet] = useState(null); // 'doc' | 'grant' | null
  const [busy, setBusy] = useState(false);

  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => api("/api/health") });
  const sets = health?.questionSets ?? {};

  const { data: docs } = useQuery({
    queryKey: ["vaults", address],
    queryFn: () => api(`/api/vaults?owner=${address}`),
    enabled: isConnected,
  });
  const { data: grants } = useQuery({
    queryKey: ["grants", address],
    queryFn: () => api(`/api/grants?owner=${address}`),
    enabled: isConnected,
    refetchInterval: 15_000,
  });

  const [doc, setDoc] = useState({ label: "", kind: "payslip", days: 180, pass: "", text: "" });
  // No `param` and no templated question any more. The owner grants a coarse
  // right - "you may ask about money" - and the verifier writes the actual
  // question in their own words. `param` was still being read off TOPICS, which
  // no longer has it, so the form rendered a field labelled "Value" and could
  // sign a question reading "Is monthly income above INR ?".
  const [g, setG] = useState({
    vaultId: "", verifier: "", verifierName: "", set: "income", uses: 3, life: "m:10",
  });

  const vaults = docs?.vaults ?? [];
  // Bind the select to real state as soon as documents exist, so what is shown
  // and what gets signed are the same value.
  if (vaults.length && !g.vaultId) {
    queueMicrotask(() => setG((v) => (v.vaultId ? v : { ...v, vaultId: vaults[0].vaultId })));
  }
  const all = grants?.grants ?? [];
  // "Live" has to mean the same thing here as it does on a ticket, or the
  // heading and the cards contradict each other on screen.
  const isLive = (x) =>
    x.diesAt > Date.now() && x.state === "live" && x.usesSpent < x.usesAllowed;
  const live = all.filter(isLive);
  const past = all.filter((x) => !isLive(x));
  const topic = TOPICS[g.set];

  async function seal() {
    if (!doc.text.trim()) return toast.error("there is nothing to seal yet");
    if (doc.pass.length < 6) return toast.error("use a passphrase of at least 6 characters");
    setBusy(true);
    try {
      const e = await encryptDocument(doc.text, doc.pass);
      const res = await api("/api/vault", {
        body: {
          owner: address, label: doc.label || "Untitled", docKind: doc.kind,
          sha256: e.sha256, iv: e.iv, cipher: e.cipherHex, days: Number(doc.days),
        },
      });
      toast.success(`Sealed — ${e.bytesLen.toLocaleString()} bytes, unreadable without your passphrase.`);
      setSheet(null);
      setDoc({ label: "", kind: "payslip", days: 180, pass: "", text: "" });
      setG((s) => ({ ...s, vaultId: res.vaultId }));
      qc.invalidateQueries({ queryKey: ["vaults", address] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    // No silent fallback. The whole claim is that you sign the exact terms, so
    // the signed vaultId must be the one the select is actually showing -
    // never an inferred default.
    const vaultId = g.vaultId;
    if (!vaultId) return toast.error("choose which document this is about");
    if (!/^0x[0-9a-fA-F]{40}$/.test(g.verifier)) return toast.error("that is not a complete address yet");
    if (g.verifier.toLowerCase() === address.toLowerCase()) {
      return toast.error("issue it to the other person's address, not your own");
    }

    const [unit, n] = g.life.split(":");
    const diesAt = Date.now() + (unit === "m" ? Number(n) * 60_000 : Number(n) * 86_400_000);
    setBusy(true);
    try {
      // The owner signs the exact terms; the server verifies this before it
      // spends its own gas. It can pay for a grant but cannot author one.
      // What is signed is the RIGHT, not a sentence: this person, this topic,
      // this many times, until this moment.
      const question = `May ask about ${topic?.label?.toLowerCase() ?? g.set}`;
      const ownerSig = await signTypedDataAsync({
        domain: DOMAIN, types: { Grant: TYPES.Grant }, primaryType: "Grant",
        message: {
          vaultId, verifier: g.verifier, questionSet: g.set, question,
          usesAllowed: BigInt(g.uses), diesAt: BigInt(diesAt), statement: STATEMENTS.grant,
        },
      });
      const res = await api("/api/grant", {
        body: {
          vaultId, owner: address, verifier: g.verifier,
          verifierName: g.verifierName || short(g.verifier, 6, 4),
          questionSet: g.set, question, usesAllowed: Number(g.uses), diesAt,
          threshold: "", ownerSig,
          minutes: unit === "m" ? Number(n) : null,
          days: unit === "d" ? Number(n) : null,
        },
      });
      await navigator.clipboard?.writeText(`${location.origin}/ask?grant=${res.grantId}`).catch(() => {});
      toast.success("Issued. The link is on your clipboard — send it to them.");
      setSheet(null);
      qc.invalidateQueries({ queryKey: ["grants", address] });
    } catch (err) {
      toast.error(err.shortMessage ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(grant) {
    try {
      await api("/api/grant/revoke", { method: "POST", body: { entityKey: grant.entityKey } });
      toast("Revoked. They cannot ask again.");
      qc.invalidateQueries({ queryKey: ["grants", address] });
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (!isConnected) return <Gate />;

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-20 pt-10">
      <Inbox />

      {/* The heading states the actual situation rather than naming the page. */}
      <div className="flex items-end justify-between gap-6 border-b border-line pb-4">
        <div>
          {/* The page's one display moment, and it states the situation in
              every branch - so a separate centred empty state is unnecessary. */}
          <h1 className="max-w-[22ch] text-[clamp(1.75rem,1.3rem+1.8vw,2.5rem)]">
            {live.length === 0 ? (
              vaults.length ? (
                <>Nothing is being asked.<br /><span className="italic text-ink-50">That is the resting state.</span></>
              ) : (
                <>Start by sealing <span className="italic">a document.</span></>
              )
            ) : live.length === 1 ? (
              <>One person can ask you <span className="italic">one question.</span></>
            ) : (
              <>{live.length} permissions are <span className="italic">alive.</span></>
            )}
          </h1>
        </div>
        <button
          className="btn btn-primary btn-sm shrink-0"
          onClick={() => setSheet(vaults.length ? "grant" : "doc")}
        >
          {vaults.length ? <Plus size={14} /> : <Lock size={14} />}
          {vaults.length ? "Issue" : "Seal a document"}
        </button>
      </div>

      {live.length > 0 ? (
        <motion.div layout className="mt-6 grid max-w-[720px] gap-4">
          <AnimatePresence mode="popLayout">
            {live.map((gr) => (
              <PermissionTicket key={gr.grantId} grant={gr} onRevoke={revoke} />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <p className="max-w-[46ch] py-10 text-[0.9375rem] leading-relaxed text-ink-50">
          {vaults.length
            ? "Issue someone a permission and it appears here, counting down to its own expiry."
            : "Seal one below. It is encrypted in this tab, and what leaves is ciphertext carrying its own death block."}
        </p>
      )}

      {/* Spent and expired, folded away. Kept because their absence is the point. */}
      {past.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer list-none border-t border-line pt-4 font-mono text-[0.75rem] text-ink-50 transition-colors hover:text-ink">
            {past.length} expired or spent — nothing was deleted, the network stopped returning them
          </summary>
          {/* A dead permission is a row, not an object. That one distinction
              carries more hierarchy than any amount of greying. */}
          <ul className="m-0 mt-3 list-none p-0">
            {past.map((gr) => (
              <li key={gr.grantId}
                className="flex items-baseline gap-3 border-b border-line py-2 text-[0.8125rem] last:border-0">
                <span className="w-[13ch] shrink-0 truncate font-mono text-[0.75rem] text-ink-50">
                  {gr.verifierName || short(gr.verifier, 6, 4)}
                </span>
                <span className="flex-1 truncate text-ink-50">{gr.note || "\u2014"}</span>
                <span className="shrink-0 font-mono text-[0.75rem] text-ink-50">
                  {gr.usesSpent >= gr.usesAllowed ? "spent" : gr.state === "revoked" ? "revoked" : "expired"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Documents are deliberately secondary: you touch them once. */}
      <section className="mt-20 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-mono text-[0.75rem] uppercase tracking-[0.13em] text-ink-50">
            Sealed documents
          </h2>
          <button className="btn btn-sm btn-quiet" onClick={() => setSheet("doc")}>
            <Plus size={13} />Add
          </button>
        </div>

        {vaults.length ? (
          <ul className="m-0 mt-2 list-none p-0">
            {vaults.map((v) => {
              const Icon = KIND_ICON[v.docKind] ?? FileText;
              return (
                <li key={v.vaultId} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <Icon size={14} className="shrink-0 text-ink-30" />
                  <span className="flex-1 truncate text-[0.875rem]">{v.label}</span>
                  <span className="font-mono tnum text-[0.75rem] text-ink-50">
                    {(v.bytesLen / 1024).toFixed(1)} KiB
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-[0.8125rem] text-ink-50">None yet.</p>
        )}
      </section>

      {/* ------------------------------------------------------- sheets -- */}

      <Sheet
        open={sheet === "doc"}
        onClose={() => {
          // The plaintext was only needed while this sheet was open. Leaving it
          // in React state keeps a decrypted document alive for the life of the
          // page, which is not a thing this product should do.
          setDoc({ label: "", kind: "payslip", days: 180, pass: "", text: "" });
          setSheet(null);
        }}
        title="Seal a document"
        subtitle="Read and encrypted in this tab. The file itself is never uploaded — not to us, and not to the enclave."
        footer={
          <button className="btn btn-primary w-full" onClick={seal} disabled={busy}>
            <Lock size={15} />{busy ? "Encrypting…" : "Encrypt & store"}
          </button>
        }
      >
        <div className="space-y-5">
          <DropDoc
            disabled={busy}
            onText={(text, meta) =>
              setDoc((d) => ({ ...d, text, label: d.label || meta.name.replace(/\.[^.]+$/, "") }))
            }
          />
          <div>
            <label className="field-label">What was read</label>
            <textarea
              className="input font-mono text-[0.8125rem] leading-relaxed"
              rows={9}
              spellCheck={false}
              placeholder="Drop a file above, or type the contents here."
              value={doc.text}
              onChange={(e) => setDoc({ ...doc, text: e.target.value })}
            />
            <p className="mt-1.5 text-[0.75rem] text-ink-50">
              Check it before sealing — this is exactly what gets encrypted.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label">Name it</label>
              <input className="input" placeholder="Payslip — Oct 2026"
                value={doc.label} onChange={(e) => setDoc({ ...doc, label: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Kind</label>
              <select className="input" value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>
                <option value="payslip">Payslip</option>
                <option value="bank">Bank statement</option>
                <option value="rent">Rent agreement</option>
                <option value="identity">Identity document</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label">Passphrase</label>
              <input className="input font-mono" type="password" placeholder="at least 6 characters"
                value={doc.pass} onChange={(e) => setDoc({ ...doc, pass: e.target.value })} />
              <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-50">
                Never sent. You need it again to answer a question.
              </p>
            </div>
            <div>
              <label className="field-label">Keep for</label>
              <select className="input" value={doc.days} onChange={(e) => setDoc({ ...doc, days: e.target.value })}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days — the maximum</option>
              </select>
            </div>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={sheet === "grant"}
        onClose={() => setSheet(null)}
        title="Issue a permission"
        subtitle="One question, a few uses, an expiry. You will sign the exact terms."
        footer={
          <button className="btn btn-primary w-full" onClick={issue} disabled={busy}>
            {busy ? "Check your wallet…" : "Sign & issue"}
          </button>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="field-label">About which document</label>
            <select className="input" value={g.vaultId} onChange={(e) => setG({ ...g, vaultId: e.target.value })}>
              {vaults.map((v) => <option key={v.vaultId} value={v.vaultId}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Who may ask</label>
            <input className="input font-mono text-[0.8125rem]" placeholder="0x… their address, not yours"
              value={g.verifier} onChange={(e) => setG({ ...g, verifier: e.target.value })} />
            <p className="mt-1.5 text-[0.75rem] text-ink-50">
              Only this address can use the link. Anyone else is refused.
            </p>
          </div>
          <div>
            <label className="field-label">Call them</label>
            <input className="input" placeholder="landlord.eth"
              value={g.verifierName} onChange={(e) => setG({ ...g, verifierName: e.target.value })} />
          </div>
          <div>
            <label className="field-label">What they may ask about</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(TOPICS).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setG({ ...g, set: k })}
                  className={
                    "rounded-[10px] border px-3.5 py-3 text-left transition-colors " +
                    (g.set === k
                      ? "border-ink bg-seal-wash"
                      : "border-line-2 hover:border-ink-50")
                  }
                >
                  <span className="block text-[0.875rem] font-semibold">{t.label}</span>
                  <span className="mt-0.5 block text-[0.75rem] leading-snug text-ink-50">{t.blurb}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label">How many times</label>
              <input className="input font-mono tnum" type="number" min={1} max={20}
                value={g.uses} onChange={(e) => setG({ ...g, uses: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Dies in</label>
              <select className="input" value={g.life} onChange={(e) => setG({ ...g, life: e.target.value })}>
                <option value="m:2">2 minutes</option>
                <option value="m:10">10 minutes</option>
                <option value="d:1">1 day</option>
                <option value="d:7">7 days</option>
              </select>
            </div>
          </div>

          <div className="rounded-[12px] border-[1.6px] border-ink bg-paper p-5">
            <p className="eyebrow">They will write their own question</p>
            <p className="mt-3 text-[0.875rem] leading-relaxed text-ink-70">
              Anything about <strong className="font-semibold text-ink">{topic?.blurb}</strong> —
              in their words, not a template. You see exactly what they asked before you answer,
              and you can always turn it down.
            </p>
            {topic?.examples?.length > 0 && (
              <p className="mt-3 font-serif text-[1.0625rem] leading-snug text-ink-50">
                e.g. “{topic.examples[0]}”
              </p>
            )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
