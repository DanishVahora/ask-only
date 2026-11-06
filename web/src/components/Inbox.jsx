import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { Check, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  api, decryptDocument, askEnclaveDirect, DOMAIN, TYPES, STATEMENTS, short, timeAgo,
} from "../lib/askonly.js";

/**
 * The owner's inbox.
 *
 * This component is the protocol. Only this device holds the passphrase, so
 * only this device can decrypt and ask the enclave — which is precisely why
 * the verifier can request an answer but never produce one.
 *
 * Nothing here is sent to our server except a signed result. Not the
 * passphrase, not the document key, not the plaintext.
 */
export default function Inbox() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();
  const [working, setWorking] = useState(null);
  const [stage, setStage] = useState("");

  const { data } = useQuery({
    queryKey: ["inbox", address],
    queryFn: () => api(`/api/inbox?owner=${address}`),
    enabled: Boolean(address),
    refetchInterval: 4000, // someone is waiting; check often
  });

  const pending = data?.pending ?? [];

  async function decide(req, approve) {
    setWorking(req.requestId);
    try {
      if (!approve) {
        setStage("declining…");
        const sig = await signTypedDataAsync({
          domain: DOMAIN, types: { Answer: TYPES.Answer }, primaryType: "Answer",
          message: {
            requestId: req.requestId, grantId: req.grantId, questionHash: req.questionHash,
            answerHash: "", enclaveRequestId: "", statement: STATEMENTS.answer,
          },
        });
        await api("/api/answer", {
          body: { requestId: req.requestId, owner: address, ownerSig: sig, decision: "refused" },
        });
        toast("Declined. They are told nothing.");
        qc.invalidateQueries({ queryKey: ["inbox", address] });
        return;
      }

      // 1. the passphrase, asked for here and used here
      const pass = window.prompt(
        `Passphrase for this document.\n\nIt is used in this page to decrypt and is never sent anywhere.`,
      );
      if (!pass) return;

      setStage("decrypting locally…");
      const vault = await api(`/api/vault?id=${encodeURIComponent(req.vaultId)}`);
      const plaintext = await decryptDocument(vault.cipher, vault.iv, pass);

      // 2. narrow it. The enclave does not get the whole document either.
      setStage("narrowing…");
      const prep = await api("/api/ask/prepare", {
        body: { questionSet: req.questionSet, param: req.question.match(/\d[\d,]*/)?.[0] ?? "", plaintext },
      });

      // 3. this browser calls the enclave itself, with the owner's own key
      const key =
        localStorage.getItem("askonly.0g") ||
        window.prompt("Your 0G API key — stays in this browser, sent only to router-api.0g.ai:");
      if (!key) return;
      localStorage.setItem("askonly.0g", key);

      setStage(`in the enclave · ${prep.minimisation.keptLines} of ${prep.minimisation.totalLines} lines`);
      const result = await askEnclaveDirect(prep, key);

      // 4. sign the result, so the record cannot be authored by anyone else
      setStage("sign to record…");
      const sig = await signTypedDataAsync({
        domain: DOMAIN, types: { Answer: TYPES.Answer }, primaryType: "Answer",
        message: {
          requestId: req.requestId, grantId: req.grantId, questionHash: req.questionHash,
          answerHash: result.answerHash, enclaveRequestId: result.enclaveRequestId,
          statement: STATEMENTS.answer,
        },
      });
      await api("/api/answer", {
        body: { requestId: req.requestId, owner: address, ownerSig: sig, decision: "answered", ...result },
      });
      toast.success(
        `Answered ${result.answer.toUpperCase()}. The enclave saw ${prep.minimisation.keptLines} of ${prep.minimisation.totalLines} lines.`,
      );
      qc.invalidateQueries({ queryKey: ["inbox", address] });
      qc.invalidateQueries({ queryKey: ["grants", address] });
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setWorking(null);
      setStage("");
    }
  }

  return (
    <AnimatePresence>
      {pending.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          className="mb-10 overflow-hidden"
        >
          <div className="rounded-xl border-[1.6px] border-ink bg-forest p-6 text-on-forest">
            <div className="mb-5 flex items-center gap-2.5">
              <span className="h-[7px] w-[7px] rounded-full bg-mint breathe" />
              <h2 className="font-sans text-[1.0625rem] font-semibold tracking-[-0.015em] text-on-forest">
                {pending.length === 1 ? "Someone is waiting on you" : `${pending.length} people are waiting on you`}
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

                  {working === req.requestId ? (
                    <div className="mt-4 flex items-center gap-3 font-mono text-[0.8125rem] text-mint">
                      <span className="h-[6px] w-[6px] rounded-full bg-mint breathe" />
                      {stage || "working…"}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="btn btn-sm border-mint bg-mint text-ink"
                        onClick={() => decide(req, true)}
                        disabled={Boolean(working)}
                      >
                        <ShieldCheck size={14} />Answer it
                      </button>
                      <button
                        className="btn btn-sm border-[rgba(244,243,220,0.4)] text-on-forest"
                        onClick={() => decide(req, false)}
                        disabled={Boolean(working)}
                      >
                        <X size={14} />Decline
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-5 text-[0.8125rem] leading-relaxed text-on-forest-2">
              Your device decrypts and asks the enclave. The passphrase does not leave this page,
              and they never receive the document — only the answer.
            </p>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
