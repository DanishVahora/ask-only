import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAnswering } from "../lib/answering.jsx";
import Sheet from "./Sheet.jsx";
import { PassField } from "./ui.jsx";

/**
 * Only for a permission this browser holds no key for: one issued from another device,
 * or from before this browser's data was cleared. In the normal flow nobody sees this.
 */
export default function UnlockSheet({ doc, diesAtMs, onClose }) {
  const { unlockWithSignature, hasKey, saveKey } = useAnswering();
  const [pass, setPass] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPass("");
    setKey("");
  }, [doc?.vaultId]);

  const ready = pass && (hasKey || key.trim());

  async function go() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (key.trim()) {
        const problem = await saveKey(key);
        if (problem) throw new Error(problem);
      }
      await unlockWithSignature({ vaultId: doc.vaultId, label: doc.label, pass, diesAtMs });
      setPass("");
      toast.success(`Answering for ${doc.label} from this browser`);
      onClose();
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={Boolean(doc)}
      onClose={() => { setPass(""); onClose(); }}
      title={`Unlock ${doc?.label ?? "this document"}`}
      subtitle="This browser doesn't hold the key for it yet. Unlock once and it answers from here, by itself."
      footer={
        <button className="btn btn-primary btn-lg w-full" onClick={go} disabled={busy || !ready}>
          {busy ? "Check your wallet…" : "Sign and unlock"}
        </button>
      }
    >
      <div className="space-y-5">
        <PassField
          value={pass}
          onChange={setPass}
          autoFocus
          label="Your passphrase"
          placeholder="The one you sealed it with"
          onEnter={go}
        />
        {!hasKey && (
          <div>
            <label className="field-label" htmlFor="unlock-key">Your 0G API key</label>
            <input
              id="unlock-key"
              className="input font-mono text-[0.8125rem]"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}
