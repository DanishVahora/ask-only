import { motion } from "motion/react";
import clsx from "clsx";

import { remaining } from "../lib/askonly.js";
import { WaxSeal } from "./Paper.jsx";
import { Perf } from "./ui.jsx";

const sealedOn = (ms) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;

/**
 * A sealed document, as an object.
 *
 * Size follows consequence, which is what makes this a bento rather than a card grid.
 * A document somebody can ask about right now takes two columns, because that is the
 * one you might need to act on. A dormant one takes one. The size is earned by what it
 * holds, never assigned for rhythm.
 *
 * Every action is visible without opening a menu. There is no edit, on purpose: see
 * OpenDoc for why, and for what replaces it.
 */
export default function DocumentTile({ doc, reviewers = [], onAdd, onRead, onDelete }) {
  const wide = reviewers.length > 0;
  const soonest = wide ? Math.min(...reviewers.map((g) => g.diesAt)) : null;

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={clsx("tile flex flex-col", wide && "sm:col-span-2")}
    >
      <div className="flex-1 p-6">
        <WaxSeal className="h-11 w-11" />
        <h2
          className="mt-5 line-clamp-2 break-words font-serif text-[1.625rem] leading-[1.15] tracking-[-0.018em]"
          title={doc.label}
        >
          {doc.label}
        </h2>
        <p className="mt-1.5 font-mono tnum text-[0.75rem] text-ink-50">
          {(doc.bytesLen / 1024).toFixed(1)} KiB
          {sealedOn(doc.createdAt) ? ` · sealed ${sealedOn(doc.createdAt)}` : ""}
        </p>
        {wide && (
          <p className="mt-3 text-[0.875rem] leading-snug text-ink-70">
            <span className="font-medium text-ink">
              {reviewers.length === 1 ? reviewers[0].verifierName : `${reviewers.length} reviewers`}
            </span>{" "}
            can ask, {remaining(soonest).text} left
          </p>
        )}
      </div>

      <Perf />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-4">
        <button className="btn btn-sm" onClick={() => onAdd(doc)}>Add a reviewer</button>
        <div className="flex gap-3">
          <button className="link-action" onClick={() => onRead(doc)}>Read</button>
          <button className="link-action link-action-danger" onClick={() => onDelete(doc)}>Delete</button>
        </div>
      </div>
    </motion.article>
  );
}
