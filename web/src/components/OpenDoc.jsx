import { useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { api, decryptDocument } from "../lib/askonly.js";
import Sheet from "./Sheet.jsx";
import { PassField } from "./ui.jsx";

/**
 * Read back a document you sealed.
 *
 * Until now the only way to see your own document was to answer somebody's
 * question about it. You could seal a file and then have no way of checking what
 * you had actually sealed, which asks for more trust than this product deserves.
 *
 * There is no edit. A permission may already point at this document, and changing
 * what it says underneath someone would change what they were given. "New version"
 * carries the text into a fresh seal instead, and the old one stays until deleted.
 *
 * It decrypts in this tab and nowhere else, and it always takes the passphrase, even
 * when this browser keeps a key to answer with: answering for you is one thing, and
 * showing the whole document to whoever is at this screen is another.
 */
export default function OpenDoc({ doc, onClose, onNewVersion }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState(null);
  const plaintext = useRef(null);

  const wipe = () => {
    plaintext.current = null;
    setText(null);
    setPass("");
  };

  useEffect(() => () => { plaintext.current = null; }, []);

  const close = () => {
    wipe();
    onClose();
  };

  async function unlock() {
    if (!pass || busy) return;
    setBusy(true);
    try {
      const vault = await api(`/api/vault?id=${encodeURIComponent(doc.vaultId)}`);
      const plain = await decryptDocument(vault.cipher, vault.iv, pass);
      plaintext.current = plain;
      setText(plain);
      setPass("");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const lines = text ? text.split("\n").length : 0;

  return (
    <Sheet
      open={Boolean(doc)}
      onClose={close}
      title={doc?.label ?? "Document"}
      subtitle={
        text
          ? "Decrypted in this tab only. Closing this clears this copy."
          : "Only your passphrase opens this, and it isn't sent anywhere."
      }
      footer={
        text ? (
          <div className="flex gap-2">
            <button
              className="btn btn-lg flex-1"
              onClick={() => {
                const next = { label: nextName(doc.label), text };
                wipe();
                onNewVersion?.(next);
              }}
            >
              Seal a new version
            </button>
            <button className="btn btn-primary btn-lg flex-1" onClick={close}>Close</button>
          </div>
        ) : (
          <button className="btn btn-primary btn-lg w-full" onClick={unlock} disabled={busy || !pass}>
            <KeyRound size={16} strokeWidth={1.75} />
            {busy ? "Opening…" : "Open"}
          </button>
        )
      }
    >
      {text ? (
        <div>
          <pre className="tile m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[0.8125rem] leading-relaxed">
            {text}
          </pre>
          <p className="mt-3 font-mono tnum text-[0.75rem] text-ink-50">
            {lines} {lines === 1 ? "line" : "lines"}
          </p>
          <p className="mt-3 text-[0.875rem] leading-relaxed text-ink-70">
            This is the whole document, and only you see it like this. Reviewers only ever get yes, no or
            unknown.
          </p>
        </div>
      ) : (
        <PassField
          value={pass}
          onChange={setPass}
          autoFocus
          placeholder="The one you sealed it with"
          onEnter={unlock}
        />
      )}
    </Sheet>
  );
}

/** Payslip -> Payslip v2 -> Payslip v3. */
function nextName(label = "Untitled") {
  const m = label.match(/^(.*) v(\d+)$/);
  return m ? `${m[1]} v${Number(m[2]) + 1}` : `${label} v2`;
}
