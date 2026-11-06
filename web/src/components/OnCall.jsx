/**
 * AskOnly — being on call.
 *
 * The complaint that produced this: "for each question, the reviewer needs to
 * wait for the issuer, why? this is some flaw".
 *
 * It was a fair hit. Only the owner's device can decrypt, which is the whole
 * product — but that does NOT mean the person asking should wait on a human to
 * notice a notification. Two things made them wait:
 *
 *   1. the passphrase had to be re-typed for every single question, and
 *   2. every answer needed a wallet popup.
 *
 * Being on call removes both, without moving a secret anywhere:
 *
 *   - the passphrase is typed ONCE and the decrypted text is held in this
 *     component's memory. Not localStorage, not sessionStorage — a ref.
 *     Reload the tab and it is gone.
 *   - one signature authorises an EPHEMERAL key, generated in this tab, to
 *     sign answers for THIS ONE DOCUMENT until a deadline you pick. The server
 *     verifies that delegation against the owner's signature on every answer.
 *
 * What it deliberately does not do: widen what the enclave sees. Each question
 * still gets its own minimised extract, chosen by the same matcher the manual
 * path uses. Being on call changes who clicks, not what is disclosed.
 */

import { useEffect, useRef, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { motion, AnimatePresence } from "motion/react";
import { Radio, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api, decryptDocument, askEnclaveDirect, DOMAIN, TYPES, STATEMENTS, short } from "../lib/askonly.js";
import { selectLines, extractFrom, enclaveRequest } from "../lib/questions.js";

const POLL_MS = 2500;

export default function OnCall({ vaults }) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();

  const [vaultId, setVaultId] = useState("");
  const [pass, setPass] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [key0g, setKey0g] = useState(() => localStorage.getItem("askonly.0g") ?? "");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null);
  const [log, setLog] = useState([]);

  /* The decrypted document lives here and nowhere else. A ref, so it is not
   * serialised into any persisted store. */
  const plaintext = useRef(null);
  const answering = useRef(new Set());

  const note = (line) => setLog((l) => [{ ...line, at: Date.now() }, ...l].slice(0, 6));

  function standDown(reason) {
    plaintext.current = null;
    answering.current = new Set();
    setLive(null);
    setPass("");
    if (reason) toast(reason);
  }

  async function goOnCall() {
    if (!vaultId) return toast.error("pick which document you are on call for");
    if (!pass) return toast.error("your passphrase unlocks it, once");
    if (!key0g.trim()) return toast.error("your 0G key is what reaches the enclave");
    setBusy(true);
    try {
      const vault = await api(`/api/vault?id=${encodeURIComponent(vaultId)}`);
      // Decrypt first: a wrong passphrase should fail before a wallet popup.
      plaintext.current = await decryptDocument(vault.cipher, vault.iv, pass);

      const account = privateKeyToAccount(generatePrivateKey());
      const diesAt = Math.floor(Date.now() / 1000) + Number(minutes) * 60;

      const sig = await signTypedDataAsync({
        domain: DOMAIN,
        types: { Delegation: TYPES.Delegation },
        primaryType: "Delegation",
        message: {
          vaultId,
          sessionKey: account.address,
          diesAt: BigInt(diesAt),
          statement: STATEMENTS.delegation,
        },
      });

      localStorage.setItem("askonly.0g", key0g.trim());
      setPass("");
      setLive({
        vaultId,
        diesAt,
        account,
        label: vaults.find((v) => v.vaultId === vaultId)?.label ?? vaultId,
        delegation: { owner: address, vaultId, sessionKey: account.address, diesAt, sig },
      });
      setLog([]);
      toast.success(`On call for ${Number(minutes)} minutes. Questions get answered in seconds.`);
    } catch (e) {
      plaintext.current = null;
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------- the loop --- */
  useEffect(() => {
    if (!live || !address) return undefined;
    let stop = false;

    const tick = async () => {
      if (stop) return;
      if (Date.now() / 1000 >= live.diesAt) {
        standDown("Off call — the window closed.");
        return;
      }

      let pending = [];
      try {
        pending = (await api(`/api/inbox?owner=${address}`))?.requests ?? [];
      } catch {
        return;
      }

      for (const r of pending) {
        if (stop) return;
        if (r.vaultId !== live.vaultId) continue; // scoped to one document
        if (answering.current.has(r.requestId)) continue;
        answering.current.add(r.requestId);

        try {
          // Same minimisation as the manual path — being on call does not hand
          // the enclave any more of the document than a click would.
          const sel = selectLines(plaintext.current, r.question);
          if (!sel.anyMatch) {
            note({ q: r.question, kind: "skipped", detail: "nothing matched — left for you to answer" });
            continue;
          }
          const { extract, keptLines, totalLines } = extractFrom(sel.lines, sel.suggested);
          const result = await askEnclaveDirect(enclaveRequest(r.question, extract), key0g.trim());

          // Signed by the session key, not the wallet. No popup.
          const sig = await live.account.signTypedData({
            domain: DOMAIN,
            types: { Answer: TYPES.Answer },
            primaryType: "Answer",
            message: {
              requestId: r.requestId,
              grantId: r.grantId,
              questionHash: r.questionHash,
              answerHash: result.answerHash,
              enclaveRequestId: result.enclaveRequestId,
              statement: STATEMENTS.answer,
            },
          });
          await api("/api/answer", {
            body: {
              requestId: r.requestId,
              owner: address,
              signer: live.account.address,
              ownerSig: sig,
              decision: "answered",
              delegation: live.delegation,
              ...result,
            },
          });
          note({ q: r.question, kind: result.answer, detail: `${keptLines} of ${totalLines} lines` });
          qc.invalidateQueries({ queryKey: ["inbox", address] });
          qc.invalidateQueries({ queryKey: ["grants", address] });
        } catch (e) {
          answering.current.delete(r.requestId); // let it retry
          note({
            q: r.question,
            kind: "failed",
            detail: String(e.shortMessage ?? e.message).slice(0, 80),
          });
        }
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [live, address, key0g, qc]);

  /* Leaving the page must not leave a decrypted document in memory. */
  useEffect(() => () => { plaintext.current = null; }, []);

  const left = live ? Math.max(0, live.diesAt - Math.floor(Date.now() / 1000)) : 0;

  return (
    <div className="rounded-[14px] border-[1.6px] border-ink bg-paper p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <Radio size={12} strokeWidth={2} /> On call
          </p>
          <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-70">
            {live ? (
              <>
                Answering questions about{" "}
                <strong className="font-semibold text-ink">{live.label}</strong> by itself.
                Nobody is waiting on you.
              </>
            ) : (
              <>
                Unlock once and this tab answers questions as they arrive — in seconds, with no
                popup each time. The document never leaves it.
              </>
            )}
          </p>
        </div>
        {live && (
          <span className="shrink-0 rounded-full bg-seal-wash px-2.5 py-1 font-mono text-[0.6875rem] text-seal">
            {Math.floor(left / 60)}m {String(left % 60).padStart(2, "0")}s
          </span>
        )}
      </div>

      {!live ? (
        <div className="mt-4 space-y-3">
          <select className="input" value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
            <option value="">Which document?</option>
            {vaults.map((v) => (
              <option key={v.vaultId} value={v.vaultId}>{v.label}</option>
            ))}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              type="password"
              placeholder="passphrase — typed once"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <select className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
              {[10, 30, 60, 240].map((m) => (
                <option key={m} value={m}>for {m} minutes</option>
              ))}
            </select>
          </div>
          <input
            className="input font-mono text-[0.8125rem]"
            type="password"
            placeholder="0G API key"
            value={key0g}
            onChange={(e) => setKey0g(e.target.value)}
          />
          <button className="btn btn-primary w-full" onClick={goOnCall} disabled={busy}>
            {busy ? "Check your wallet…" : "Go on call"}
          </button>
          <p className="text-[0.75rem] leading-snug text-ink-50">
            One signature authorises this tab — and only this tab, for this one document, until
            the time runs out. Reload and it is gone.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {log.length === 0 && (
                <motion.p
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 text-[0.8125rem] text-ink-50"
                >
                  <Loader2 size={13} className="animate-spin" /> Listening…
                </motion.p>
              )}
              {log.map((l) => (
                <motion.div
                  key={l.at}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2.5 border-b border-line pb-2 last:border-0"
                >
                  <span className="mt-[3px] shrink-0">
                    {l.kind === "yes" ? (
                      <Check size={13} className="text-seal" />
                    ) : l.kind === "no" ? (
                      <X size={13} className="text-clay" />
                    ) : (
                      <span className="block h-[7px] w-[7px] rounded-full bg-ink-30" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem]">{l.q}</span>
                    <span className="block text-[0.6875rem] text-ink-50">
                      {l.kind === "skipped" || l.kind === "failed"
                        ? l.detail
                        : `${l.kind.toUpperCase()} · the enclave saw ${l.detail}`}
                    </span>
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <button className="btn btn-ghost mt-4 w-full" onClick={() => standDown("Off call.")}>
            Stand down
          </button>
          <p className="mt-2 font-mono text-[0.6875rem] text-ink-30">
            session key {short(live.account.address, 10, 6)}
          </p>
        </div>
      )}
    </div>
  );
}
