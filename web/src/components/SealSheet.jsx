import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { api, encryptDocument } from "../lib/askonly.js";
import DropDoc from "./DropDoc.jsx";
import Sheet from "./Sheet.jsx";
import { PassField, Segmented } from "./ui.jsx";

const BLANK = { label: "", days: 180, pass: "", text: "" };

/**
 * Seal a document, or a new version of one.
 *
 * "What kind of thing is it?" is gone. Nothing in the protocol cares, and the field
 * invited exactly what happened: a ticket labelled with its owner's name. The fewer
 * questions between a person and a sealed document, the better.
 */
export default function SealSheet({ open, initial, onClose, onSealed }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const [doc, setDoc] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setDoc({ ...BLANK, ...(initial ?? {}) });
  }, [open, initial]);

  // The plaintext was only needed while this was open. Keeping it in state would
  // leave a decrypted document alive for the life of the page.
  const close = () => {
    setDoc(BLANK);
    onClose();
  };

  const ready = doc.text.trim() && doc.pass.length >= 6;

  async function seal() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const e = await encryptDocument(doc.text, doc.pass);
      const res = await api("/api/vault", {
        body: {
          owner: address,
          label: doc.label.trim() || "Untitled",
          docKind: "document",
          sha256: e.sha256,
          iv: e.iv,
          cipher: e.cipherHex,
          days: Number(doc.days),
        },
      });
      toast.success("Sealed. Only your passphrase opens it");
      await qc.invalidateQueries({ queryKey: ["vaults", address] });
      const pass = doc.pass;
      setDoc(BLANK);
      onClose();
      onSealed?.(res.vaultId, pass);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={initial ? "Seal a new version" : "Seal a document"}
      subtitle={
        initial
          ? "The old one stays until you delete it, and any permissions keep pointing at it."
          : "It's encrypted right here, before anything leaves this browser. Only the encrypted copy is stored."
      }
      footer={
        <button className="btn btn-primary btn-lg w-full" onClick={seal} disabled={busy || !ready}>
          <Lock size={16} strokeWidth={1.75} />
          {busy ? "Encrypting…" : "Encrypt and seal"}
        </button>
      }
    >
      <div className="space-y-5">
        {!initial && (
          <DropDoc
            disabled={busy}
            onText={(text) => setDoc((d) => ({ ...d, text }))}
          />
        )}
        <div>
          <label className="field-label" htmlFor="seal-text">What gets sealed</label>
          <textarea
            id="seal-text"
            className="input font-mono text-[0.8125rem] leading-relaxed"
            rows={7}
            spellCheck={false}
            placeholder="Drop a file above, or type or paste the text here"
            value={doc.text}
            onChange={(e) => setDoc({ ...doc, text: e.target.value })}
          />
          <p className="field-hint">Give it a read. This exact text is what gets encrypted.</p>
        </div>
        <div>
          <label className="field-label" htmlFor="seal-name">Name</label>
          <input
            id="seal-name"
            className="input"
            placeholder="Payslip, October 2026"
            value={doc.label}
            onChange={(e) => setDoc({ ...doc, label: e.target.value })}
          />
          <p className="field-hint">Anyone can see the name, so keep personal details out of it.</p>
        </div>
        <div>
          <PassField
            value={doc.pass}
            onChange={(pass) => setDoc({ ...doc, pass })}
            placeholder="At least 6 characters"
            onEnter={seal}
          />
          <p className="field-hint">
            Never sent anywhere. If you lose it nobody can get the document back, including us.
          </p>
        </div>
        <Segmented
          label="Keep it for"
          value={doc.days}
          onChange={(days) => setDoc({ ...doc, days })}
          options={[
            { value: 30, label: "30 days" },
            { value: 90, label: "90 days" },
            { value: 180, label: "180 days" },
          ]}
        />
      </div>
    </Sheet>
  );
}
