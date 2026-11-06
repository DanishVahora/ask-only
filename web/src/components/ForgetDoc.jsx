import { Trash2 } from "lucide-react";

import Sheet from "./Sheet.jsx";
import { useSessions } from "../lib/session.js";

/**
 * Deleting a document, said plainly.
 *
 * A browser confirm() could not tell you that two people are currently allowed to
 * ask about the thing you are about to delete, and that consequence is the whole
 * reason to pause. This sheet is the confirmation: the browser signs the deletion with
 * the session it already holds, so no wallet popup asks the same thing a second time.
 *
 * It says exactly what happens and no more. The network stops serving the ciphertext
 * and old blocks keep what they have, encrypted, so "gone forever" would be a lie.
 */
export default function ForgetDoc({ doc, askers = [], onClose, onConfirm, busy }) {
  const { signedIn } = useSessions();
  return (
    <Sheet
      open={Boolean(doc)}
      onClose={onClose}
      title={`Delete ${doc?.label ?? "this document"}?`}
      subtitle="You can't undo this, and you won't be able to open it here again."
      footer={
        <button className="btn btn-danger btn-lg w-full" onClick={() => onConfirm(doc)} disabled={busy}>
          <Trash2 size={16} strokeWidth={1.75} />
          {busy ? (signedIn ? "Deleting…" : "Check your wallet…") : signedIn ? "Delete it" : "Sign and delete"}
        </button>
      }
    >
      <div className="space-y-3">
        {askers.length > 0 && (
          <div className="rounded-[14px] bg-clay-wash p-4">
            <p className="text-[0.875rem] font-medium">
              {askers.length === 1
                ? `${askers[0].verifierName}'s permission ends with it`
                : `${askers.length} permissions end with it`}
            </p>
            {askers.length > 1 && (
              <ul className="m-0 mt-2 list-none space-y-0.5 p-0 text-[0.8125rem] text-ink-70">
                {askers.map((g) => <li key={g.grantId}>{g.verifierName}</li>)}
              </ul>
            )}
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-70">
              They won't be able to ask anything more, and anything still waiting won't get answered.
            </p>
          </div>
        )}
        <div className="tile p-4">
          <p className="eyebrow">What happens to the data</p>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-70">
            The network stops serving the encrypted copy. Old blocks can't be rewritten, so the
            encrypted bytes may survive in chain history, as unreadable as they ever were without
            your passphrase.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
