import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

/**
 * A panel that slides in from the right.
 *
 * Forms used to expand inline, which pushed everything below them down the
 * page — so adding a document moved the permissions you were looking at. A
 * sheet leaves the page exactly where it was.
 *
 * It enters and exits along the same path, because something that disappears
 * one way should emerge from where it went. The scrim dims rather than blurs:
 * this is a modal task, so the background is pushed back rather than kept in
 * play.
 */
export default function Sheet({ open, onClose, title, subtitle, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

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
            className="fixed inset-0 z-[80] bg-[rgba(18,58,44,0.28)]"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.42 }}
            className="fixed right-0 top-0 z-[81] flex h-dvh w-full max-w-[480px] flex-col border-l-[1.6px] border-ink bg-cream"
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div>
                <h2 className="font-sans text-[1.125rem] font-semibold tracking-[-0.015em]">{title}</h2>
                {subtitle && <p className="mt-1 max-w-[42ch] text-[0.8125rem] leading-snug text-ink-50">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 -mt-1 rounded-[8px] p-2 text-ink-50 transition-colors hover:bg-cream-2 hover:text-ink"
              >
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>

            {footer && (
              <footer className="border-t border-line bg-cream-2 px-6 py-4">{footer}</footer>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
