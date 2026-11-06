import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Plus, Lock, FileText, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import {
  api, encryptDocument, sha256hex, DOMAIN, TYPES, STATEMENTS,
  QUESTION_TEXT, short, remaining,
} from "../lib/askonly.js";
import { ConnectButton } from "../components/Shell.jsx";
import Inbox from "../components/Inbox.jsx";
import Countdown from "../components/Countdown.jsx";

function Gate() {
  return (
    <div className="mx-auto max-w-[520px] px-5 py-28 text-center">
      <h1 className="text-[clamp(2rem,1.4rem+2.2vw,3rem)]">
        Connect a wallet to open <span className="italic">your</span> vault.
      </h1>
      <p className="mx-auto mt-6 max-w-[38ch] text-[0.9375rem] leading-relaxed text-ink-70">
        Your address is your identity here. Documents and permissions belong to it, not to us.
      </p>
      <div className="mt-8 flex justify-center">
        <ConnectButton size="lg" />
      </div>
    </div>
  );
}

function SectionHead({ title, action }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-3">
      <h2 className="font-sans text-[1.0625rem] font-semibold tracking-[-0.015em]">{title}</h2>
      {action}
    </div>
  );
}

export default function Vault() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();

  const [showDoc, setShowDoc] = useState(false);
  const [showGrant, setShowGrant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);

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

  const [doc, setDoc] = useState({
    label: "Payslip — Oct 2026",
    kind: "payslip",
    days: 180,
    pass: "mumbai-2026",
    text: `Tata Consultancy Services Limited
Employee: Danish Vahora
PAN: ABCDE1234F
Bank Account: HDFC 50100234567891
Address: 14 Hill Road, Bandra West, Mumbai 400050
Date of Joining: 2023-07-10
Gross: 68,000
Net Pay: 62,960`,
  });

  const [g, setG] = useState({
    vaultId: "", verifier: "", verifierName: "landlord.eth",
    set: "income", param: "50000", uses: 3, life: "m:10",
  });

  const question = (QUESTION_TEXT[g.set] ?? (() => ""))(g.param);

  async function seal() {
    if (!doc.text.trim()) return toast.error("there is nothing to seal");
    if (doc.pass.length < 6) return toast.error("use a passphrase of at least 6 characters");
    setBusy(true);
    try {
      // The whole privacy boundary, and it is three lines long.
      const e = await encryptDocument(doc.text, doc.pass);
      const res = await api("/api/vault", {
        body: {
          owner: address, label: doc.label, docKind: doc.kind,
          sha256: e.sha256, iv: e.iv, cipher: e.cipherHex, days: Number(doc.days),
        },
      });
      toast.success(`Sealed. ${e.bytesLen} bytes, unreadable without your passphrase.`);
      setShowDoc(false);
      setG((s) => ({ ...s, vaultId: res.vaultId }));
      qc.invalidateQueries({ queryKey: ["vaults", address] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    const vaultId = g.vaultId || docs?.vaults?.[0]?.vaultId;
    if (!vaultId) return toast.error("seal a document first");
    if (!/^0x[0-9a-fA-F]{40}$/.test(g.verifier)) return toast.error("that is not an address yet");

    const [unit, n] = g.life.split(":");
    const lifeMs = unit === "m" ? Number(n) * 60_000 : Number(n) * 86_400_000;
    const diesAt = Date.now() + lifeMs;
    setBusy(true);
    try {
      // The owner signs the exact terms. The server verifies this before it
      // spends its own gas - it can pay for a grant but cannot author one.
      const ownerSig = await signTypedDataAsync({
        domain: DOMAIN,
        types: { Grant: TYPES.Grant },
        primaryType: "Grant",
        message: {
          vaultId, verifier: g.verifier, questionSet: g.set, question,
          usesAllowed: BigInt(g.uses), diesAt: BigInt(diesAt),
          statement: STATEMENTS.grant,
        },
      });
      const res = await api("/api/grant", {
        body: {
          vaultId, owner: address, verifier: g.verifier, verifierName: g.verifierName,
          questionSet: g.set, question, usesAllowed: Number(g.uses), diesAt,
          threshold: g.param, ownerSig,
          minutes: unit === "m" ? Number(n) : null,
          days: unit === "d" ? Number(n) : null,
        },
      });
      const link = `${location.origin}/ask?grant=${res.grantId}`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      toast.success("Permission issued. Link copied.");
      setShowGrant(false);
      qc.invalidateQueries({ queryKey: ["grants", address] });
    } catch (err) {
      toast.error(err.shortMessage ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) return <Gate />;

  return (
    <div className="mx-auto max-w-[1180px] px-5 pb-28 pt-10">
      <Inbox />

      <div className="grid gap-10 md:grid-cols-2">
        {/* documents */}
        <section>
          <SectionHead
            title="Documents"
            action={
              <button className="btn btn-sm" onClick={() => setShowDoc((v) => !v)}>
                <Plus size={14} />Add
              </button>
            }
          />
          <AnimatePresence initial={false}>
            {showDoc && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mb-5 space-y-4 rounded-[12px] border border-line bg-paper p-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Name</label>
                      <input className="input" value={doc.label}
                        onChange={(e) => setDoc({ ...doc, label: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">Kind</label>
                      <select className="input" value={doc.kind}
                        onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>
                        <option value="payslip">Payslip</option>
                        <option value="bank">Bank statement</option>
                        <option value="rent">Rent agreement</option>
                        <option value="identity">Identity document</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="field-label">Contents</label>
                    <textarea className="input font-mono text-[0.8125rem] leading-relaxed" rows={8}
                      spellCheck={false} value={doc.text}
                      onChange={(e) => setDoc({ ...doc, text: e.target.value })} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Passphrase</label>
                      <input className="input font-mono" type="password" value={doc.pass}
                        onChange={(e) => setDoc({ ...doc, pass: e.target.value })} />
                      <p className="mt-1.5 text-[0.75rem] text-ink-50">
                        Stays on this device. You need it again to answer.
                      </p>
                    </div>
                    <div>
                      <label className="field-label">Keep for</label>
                      <select className="input" value={doc.days}
                        onChange={(e) => setDoc({ ...doc, days: e.target.value })}>
                        <option value="30">30 days</option>
                        <option value="90">90 days</option>
                        <option value="180">180 days — the maximum</option>
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={seal} disabled={busy}>
                    <Lock size={14} />{busy ? "Encrypting…" : "Encrypt & store"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2">
            {(docs?.vaults ?? []).map((v) => (
              <div key={v.vaultId}
                className="flex items-center gap-3 rounded-[10px] border border-line bg-paper px-4 py-3">
                <FileText size={16} className="shrink-0 text-ink-30" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem]">{v.label}</p>
                  <p className="font-mono tnum text-[0.75rem] text-ink-50">
                    {v.vaultId} · {v.bytesLen.toLocaleString()} bytes
                  </p>
                </div>
                <span className="tag">sealed</span>
              </div>
            ))}
            {!docs?.vaults?.length && (
              <p className="rounded-[12px] border border-dashed border-line-2 py-10 text-center text-[0.875rem] text-ink-50">
                No documents yet.
              </p>
            )}
          </div>
        </section>

        {/* permissions */}
        <section>
          <SectionHead
            title="Permissions"
            action={
              <button className="btn btn-sm" onClick={() => setShowGrant((v) => !v)}>
                <Plus size={14} />Issue
              </button>
            }
          />
          <AnimatePresence initial={false}>
            {showGrant && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mb-5 space-y-4 rounded-[12px] border border-line bg-paper p-5">
                  <div>
                    <label className="field-label">Document</label>
                    <select className="input" value={g.vaultId}
                      onChange={(e) => setG({ ...g, vaultId: e.target.value })}>
                      {(docs?.vaults ?? []).map((v) => (
                        <option key={v.vaultId} value={v.vaultId}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Who may ask</label>
                      <input className="input font-mono text-[0.8125rem]" placeholder="0x…"
                        value={g.verifier} onChange={(e) => setG({ ...g, verifier: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">Label</label>
                      <input className="input" value={g.verifierName}
                        onChange={(e) => setG({ ...g, verifierName: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Question</label>
                      <select className="input" value={g.set}
                        onChange={(e) => setG({ ...g, set: e.target.value, param: sets[e.target.value]?.param?.default ?? "" })}>
                        {Object.entries(sets).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">{sets[g.set]?.param?.name ?? "Value"}</label>
                      <input className="input font-mono" value={g.param}
                        onChange={(e) => setG({ ...g, param: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Uses</label>
                      <input className="input font-mono tnum" type="number" min={1} max={20}
                        value={g.uses} onChange={(e) => setG({ ...g, uses: e.target.value })} />
                    </div>
                    <div>
                      <label className="field-label">Expires</label>
                      <select className="input" value={g.life}
                        onChange={(e) => setG({ ...g, life: e.target.value })}>
                        <option value="m:2">2 minutes</option>
                        <option value="m:10">10 minutes</option>
                        <option value="d:1">1 day</option>
                        <option value="d:7">7 days</option>
                      </select>
                    </div>
                  </div>
                  <p className="rounded-[8px] border border-line bg-cream-2 px-3.5 py-3 font-mono text-[0.8125rem]">
                    {question}
                  </p>
                  <p className="text-[0.75rem] text-ink-50">
                    This is the only thing they will ever be able to ask.
                  </p>
                  <button className="btn btn-primary btn-sm" onClick={issue} disabled={busy}>
                    {busy ? "Check your wallet…" : "Sign & issue"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2">
            {(grants?.grants ?? []).map((gr) => {
              const r = remaining(gr.diesAt);
              const link = `${location.origin}/ask?grant=${gr.grantId}`;
              return (
                <div key={gr.grantId}
                  className={clsx(
                    "rounded-[10px] border border-line bg-paper px-4 py-3",
                    "border-l-[3px]",
                    r.dead ? "border-l-line-2 bg-cream-2" : r.ms < 60_000 ? "border-l-clay" : "border-l-seal",
                  )}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[0.875rem]">{gr.verifierName || short(gr.verifier)}</span>
                    <span className={clsx("tag", gr.state === "live" && !r.dead ? "tag-on" : "tag-stop")}>
                      {r.dead ? "expired" : gr.state}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.8125rem] text-ink-70">
                    {gr.questionSet} · {gr.usesSpent}/{gr.usesAllowed} used
                  </p>
                  <Countdown diesAt={gr.diesAt} />
                  {!r.dead && (
                    <button
                      className="btn btn-sm btn-quiet mt-2 -ml-2"
                      onClick={() => {
                        navigator.clipboard?.writeText(link);
                        setCopied(gr.grantId);
                        setTimeout(() => setCopied(null), 1600);
                      }}>
                      {copied === gr.grantId ? <Check size={13} /> : <Copy size={13} />}
                      {copied === gr.grantId ? "Copied" : "Copy link"}
                    </button>
                  )}
                </div>
              );
            })}
            {!grants?.grants?.length && (
              <p className="rounded-[12px] border border-dashed border-line-2 py-10 text-center text-[0.875rem] text-ink-50">
                No permissions issued.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
