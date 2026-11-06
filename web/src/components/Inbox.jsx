import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { X, ShieldCheck, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import { api, decryptDocument, askEnclaveDirect, DOMAIN, TYPES, STATEMENTS, short, timeAgo } from "../lib/askonly.js";
import { selectLines, extractFrom, enclaveRequest } from "../lib/questions.js";
import Sheet from "./Sheet.jsx";

/**
 * The owner's inbox — and the only place a document is ever readable.
 *
 * Everything here happens in this tab: the passphrase is typed here, the
 * document is decrypted here, the lines are chosen here, and the enclave is
 * called from here. Our server is not in this path at all.
 *
 * That last part used to be untrue. A /api/ask/prepare endpoint took the
 * decrypted plaintext, narrowed it server-side and returned a prompt — which
 * made the operator a party that sees your document, the exact thing the
 * product promises it is not. It is all local now.
 */
export default function Inbox() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();

  const [open, setOpen] = useState(null); // the request being answered
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);

  // step 1 — unlock, step 2 — choose what the enclave sees
  const [pass, setPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [doc, setDoc] = useState(null); // { lines, chosen:Set }
  const [key0g, setKey0g] = useState(() => localStorage.getItem("askonly.0g") ?? "");

  const { data } = useQuery({
    queryKey: ["inbox", address],
    queryFn: () => api(`/api/inbox?owner=${address}`),
    enabled: Boolean(address),
    refetchInterval: 4000,
  });
  const pending = data?.pending ?? [];

  function close() {
    setOpen(null);
    setPass("");
    setDoc(null); // the decrypted document must not outlive this sheet
    setStage("");
  }

  async function unlock() {
    if (!pass) return toast.error("your passphrase unlocks the document");
    setBusy(true);
    setStage("unlocking…");
    try {
      const vault = await api(`/api/vault?id=${encodeURIComponent(open.vaultId)}`);
      const plaintext = await decryptDocument(vault.cipher, vault.iv, pass);
      const sel = selectLines(plaintext, open.question);
      setDoc({ lines: sel.lines, chosen: new Set(sel.suggested), anyMatch: sel.anyMatch });
      setStage("");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!doc?.chosen.size) return toast.error("tick at least one line, or decline instead");
    if (!key0g.trim()) return toast.error("your 0G key is needed to reach the enclave");
    setBusy(true);
    try {
      localStorage.setItem("askonly.0g", key0g.trim());
      const { extract, keptLines, totalLines } = extractFrom(doc.lines, [...doc.chosen]);

      setStage(`asking the enclave · ${keptLines} of ${totalLines} lines`);
      const prepared = enclaveRequest(open.question, extract);
      const result = await askEnclaveDirect(prepared, key0g.trim());

      setStage("sign to record it…");
      const sig = await signTypedDataAsync({
        domain: DOMAIN, types: { Answer: TYPES.Answer }, primaryType: "Answer",
        message: {
          requestId: open.requestId, grantId: open.grantId, questionHash: open.questionHash,
          answerHash: result.answerHash, enclaveRequestId: result.enclaveRequestId,
          statement: STATEMENTS.answer,
        },
      });
      await api("/api/answer", {
        body: { requestId: open.requestId, owner: address, ownerSig: sig, decision: "answered", ...result },
      });
      toast.success(`Answered ${result.answer.toUpperCase()} — the enclave saw ${keptLines} of ${totalLines} lines.`);
      close();
      qc.invalidateQueries({ queryKey: ["inbox", address] });
      qc.invalidateQueries({ queryKey: ["grants", address] });
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  async function decline(req) {
    setBusy(true);
    try {
      const sig = await signTypedDataAsync({
        domain: DOMAIN, types: { Answer: TYPES.Answer }, primaryType: "Answer",
        message: {
          requestId: req.requestId, grantId: req.grantId, questionHash: req.questionHash,
          answerHash: "", enclaveRequestId: "", statement: STATEMENTS.answer,
        },
      });
      // Send exactly the empty fields that were signed, or the server rebuilds
      // a different message and rejects its own user.
      await api("/api/answer", {
        body: {
          requestId: req.requestId, owner: address, ownerSig: sig,
          decision: "refused", answerHash: "", enclaveRequestId: "",
        },
      });
      toast("Turned down. They are told nothing about the document.");
      close();
      qc.invalidateQueries({ queryKey: ["inbox", address] });
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (i) =>
    setDoc((d) => {
      const chosen = new Set(d.chosen);
      chosen.has(i) ? chosen.delete(i) : chosen.add(i);
      return { ...d, chosen };
    });

  return (
    <>
      <AnimatePresence>
        {pending.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="mb-12 overflow-hidden"
          >
            <div className="rounded-xl border-[1.6px] border-ink bg-forest p-6 text-on-forest">
              <div className="mb-5 flex items-center gap-2.5">
                <span className="h-[7px] w-[7px] rounded-full bg-mint breathe" />
                <h2 className="font-sans text-[1.0625rem] font-semibold tracking-[-0.015em] text-on-forest">
                  {pending.length === 1 ? "Someone's waiting on you" : `${pending.length} people are waiting on you`}
                </h2>
              </div>

              <div className="space-y-3">
                {pending.map((req) => (
                  <div key={req.requestId}
                    className="rounded-[12px] border border-[rgba(244,243,220,0.16)] bg-forest-2 p-5">
                    <p className="font-mono text-[0.8125rem] text-on-forest-2">
                      {req.askerName || short(req.asker, 10, 6)} · {timeAgo(req.askedAt)}
                    </p>
                    <p className="mt-2 font-serif text-[1.375rem] leading-tight tracking-[-0.02em] text-on-forest">
                      “{req.question}”
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="btn btn-sm border-mint bg-mint text-ink"
                        onClick={() => { setOpen(req); setPass(""); setDoc(null); }}
                        disabled={busy}
                      >
                        <ShieldCheck size={14} />Answer it
                      </button>
                      <button
                        className="btn btn-sm border-[rgba(244,243,220,0.4)] text-on-forest"
                        onClick={() => decline(req)}
                        disabled={busy}
                      >
                        <X size={14} />Turn it down
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-5 text-[0.8125rem] leading-relaxed text-on-forest-2">
                Only your device can answer — it is the only one holding your passphrase.
              </p>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------ answering ------ */}
      <Sheet
        open={Boolean(open)}
        onClose={close}
        title={doc ? "What may they learn?" : "Unlock your document"}
        subtitle={
          doc
            ? "Only the ticked lines go to the enclave. Everything else stays sealed."
            : "Your passphrase is used here and sent nowhere. Not to us, not to the enclave."
        }
        footer={
          doc ? (
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => setDoc(null)} disabled={busy}>
                <ArrowLeft size={14} />Back
              </button>
              <button className="btn btn-primary flex-1" onClick={send} disabled={busy}>
                {busy ? (stage || "working…") : `Ask the enclave · ${doc.chosen.size} line${doc.chosen.size === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : (
            <button className="btn btn-primary w-full" onClick={unlock} disabled={busy}>
              {busy ? (stage || "working…") : "Unlock"}
            </button>
          )
        }
      >
        {open && (
          <div className="space-y-5">
            <div className="rounded-[12px] border-[1.6px] border-ink bg-paper p-5">
              <p className="text-[0.75rem] text-ink-50">
                {open.askerName || short(open.asker, 10, 6)} asked
              </p>
              <p className="mt-2 font-serif text-[1.25rem] leading-tight tracking-[-0.02em]">
                “{open.question}”
              </p>
            </div>

            {!doc ? (
              <div>
                <label className="field-label">Passphrase</label>
                <div className="relative">
                  <input
                    className="input pr-11 font-mono"
                    type={showPass ? "text" : "password"}
                    autoFocus
                    placeholder="the one you chose when sealing it"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && unlock()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[6px] p-2 text-ink-50 hover:text-ink"
                    aria-label={showPass ? "Hide" : "Show"}
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="mt-2 text-[0.75rem] leading-snug text-ink-50">
                  Forgotten it? Nobody can recover it — that is the point. Seal the document again
                  with a new one.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="field-label !mb-0">Your document</label>
                    <div className="flex gap-3 text-[0.75rem]">
                      <button className="text-ink-50 underline-offset-4 hover:underline"
                        onClick={() => setDoc((d) => ({ ...d, chosen: new Set(d.lines.map((_, i) => i)) }))}>
                        all
                      </button>
                      <button className="text-ink-50 underline-offset-4 hover:underline"
                        onClick={() => setDoc((d) => ({ ...d, chosen: new Set() }))}>
                        none
                      </button>
                    </div>
                  </div>

                  {!doc.anyMatch && (
                    <p className="mb-2 rounded-[8px] border border-line-2 bg-cream-2 px-3 py-2 text-[0.75rem] leading-snug text-ink-70">
                      Nothing obviously matched this question, so nothing is ticked. Choose what
                      they may learn from.
                    </p>
                  )}

                  <ul className="m-0 list-none space-y-1 p-0">
                    {doc.lines.map((line, i) => {
                      const on = doc.chosen.has(i);
                      return (
                        <li key={i}>
                          <button
                            onClick={() => toggle(i)}
                            className={clsx(
                              "flex w-full items-start gap-2.5 rounded-[8px] border px-3 py-2 text-left font-mono text-[0.75rem] leading-snug transition-colors",
                              on
                                ? "border-seal bg-seal-wash text-ink"
                                : "border-transparent text-ink-30 line-through hover:border-line-2 hover:text-ink-50",
                            )}
                          >
                            <span className={clsx(
                              "mt-[1px] grid h-[14px] w-[14px] shrink-0 place-items-center rounded-[3px] border",
                              on ? "border-seal bg-seal text-white" : "border-line-2",
                            )}>
                              {on && <ShieldCheck size={9} />}
                            </span>
                            <span className="truncate">{line}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-[0.75rem] leading-snug text-ink-50">
                    {doc.chosen.size} of {doc.lines.length} lines. The rest never leaves this page.
                  </p>
                </div>

                <div>
                  <label className="field-label">Your 0G key</label>
                  <input
                    className="input font-mono text-[0.8125rem]"
                    type="password"
                    placeholder="kept in this browser only"
                    value={key0g}
                    onChange={(e) => setKey0g(e.target.value)}
                  />
                  <p className="mt-2 text-[0.75rem] leading-snug text-ink-50">
                    Your browser calls the enclave itself, so the key is sent only to 0G — never here.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
