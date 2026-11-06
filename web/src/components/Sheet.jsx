import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

/**
 * A panel that slides in from the right.
 *
 * Forms used to expand inline, which pushed everything below them down the
 * page, so adding a document moved the permissions you were looking at. A
 * sheet leaves the page exactly where it was.
 *
 * It enters and exits along the same path, because something that disappears
 * one way should emerge from where it went. The scrim dims rather than blurs:
 * this is a modal task, so the background is pushed back rather than kept in
 * play. Closing hands focus back to whatever opened it.
 */
export default function Sheet({ open, onClose, title, subtitle, children, footer }) {
  const opener = useRef(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  /* Only `open`. Callers pass a new onClose on every render, so depending on it
   * re-ran this for each keystroke, and the cleanup hands focus back to the opener:
   * every input in every sheet lost focus after one character. */
  useEffect(() => {
    if (!open) return undefined;
    opener.current = document.activeElement;
    const onKey = (e) => e.key === "Escape" && latestClose.current();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-[rgba(16,26,21,0.38)]"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.42 }}
            className="fixed right-0 top-0 z-[81] flex h-dvh w-full max-w-[480px] flex-col bg-cream shadow-[-24px_0_64px_rgba(16,26,21,0.18)]"
          >
            <header className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
              <div className="min-w-0">
                <h2 className="text-[1.75rem] leading-[1.1]">{title}</h2>
                {subtitle && (
                  <p className="mt-2 max-w-[40ch] text-[0.875rem] leading-snug text-ink-70">{subtitle}</p>
                )}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 -mt-1 shrink-0 rounded-[8px] p-2 text-ink-50 transition-colors hover:bg-cream-2 hover:text-ink"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">{children}</div>

            {footer && <footer className="border-t border-dashed border-line-2 bg-paper px-6 py-4">{footer}</footer>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
