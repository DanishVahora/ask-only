import { useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Upload, FileText, Image as ImageIcon, FileType, Loader2 } from "lucide-react";
import clsx from "clsx";
import { extractLocally, ACCEPT } from "../lib/extract.js";

/**
 * Drop a PDF, a photo or a text file.
 *
 * Everything happens in this tab. The extracted text is written straight into
 * the editable box below so the person can SEE what was read before anything
 * is encrypted — the alternative is asking them to trust a claim about their
 * own document, which is the opposite of the point.
 */
export default function DropDoc({ onText, disabled }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState(null);
  const [err, setErr] = useState(null);

  async function take(file) {
    if (!file || disabled) return;
    setErr(null);
    setNote(null);
    setBusy("reading…");
    try {
      const { text, kind, note } = await extractLocally(file, setBusy);
      onText(text, { kind, name: file.name });
      setNote({ kind, name: file.name, note });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  }

  const Icon = note?.kind === "image" ? ImageIcon : note?.kind === "pdf" ? FileType : FileText;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !busy && input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        className={clsx(
          "cursor-pointer rounded-[12px] border border-dashed px-4 py-6 text-center transition-colors",
          over ? "border-seal bg-seal-wash" : "border-line-2 bg-paper hover:border-ink-50",
          busy && "cursor-wait",
        )}
      >
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => take(e.target.files?.[0])}
        />
        {busy ? (
          <p className="flex items-center justify-center gap-2 font-mono text-[0.8125rem] text-seal">
            <Loader2 size={14} className="animate-spin" />
            {busy}
          </p>
        ) : (
          <>
            <Upload size={18} className="mx-auto mb-2 text-ink-30" />
            <p className="text-[0.875rem] font-medium">Drop a PDF, a photo, or a text file</p>
            <p className="mt-1 text-[0.75rem] text-ink-50">
              Read in this tab. The file itself is never uploaded.
            </p>
          </>
        )}
      </div>

      <AnimatePresence>
        {note && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-start gap-2.5 rounded-[10px] border border-seal bg-seal-wash px-3.5 py-3">
              <Icon size={15} className="mt-0.5 shrink-0 text-seal" />
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem] font-medium">{note.name}</p>
                <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-70">{note.note}</p>
              </div>
            </div>
          </motion.div>
        )}
        {err && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-2 rounded-[10px] border border-clay bg-clay-wash px-3.5 py-3 text-[0.8125rem] leading-snug"
          >
            {err}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
