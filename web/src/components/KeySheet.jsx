import { useEffect, useState } from "react";
import { toast } from "sonner";
import clsx from "clsx";

import { useAnswering } from "../lib/answering.jsx";
import Sheet from "./Sheet.jsx";

/**
 * Replace the 0G key this browser answers with.
 *
 * The key used to be asked for once, when the first reviewer was added, and never
 * again. A key 0G turned down left every question failing, Try again could not help,
 * and no screen offered a way out short of clearing the browser's storage.
 */
export default function KeySheet({ open, onClose }) {
  const { saveKey, keyProblem } = useAnswering();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(null);

  useEffect(() => {
    if (open) {
      setKey("");
      setWhy(null);
    }
  }, [open]);

  async function save() {
    if (!key.trim() || busy) return;
    setBusy(true);
    const problem = await saveKey(key);
    setBusy(false);
    if (problem) return setWhy(problem);
    setKey("");
    toast.success("Answering again");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your 0G API key"
      subtitle={keyProblem ?? "Your browser calls the enclave directly with it, so it only ever goes to 0G."}
      footer={
        <button className="btn btn-primary btn-lg w-full" onClick={save} disabled={busy || !key.trim()}>
          {busy ? "Checking it with 0G…" : "Save key"}
        </button>
      }
    >
      <div>
        <label className="field-label" htmlFor="zg-key">API key</label>
        <input
          id="zg-key"
          className={clsx("input font-mono text-[0.8125rem]", why && "input-bad")}
          type="password"
          autoComplete="off"
          autoFocus
          placeholder="sk-…"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setWhy(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        {why ? (
          <p className="field-hint !text-clay">{why}</p>
        ) : (
          <p className="field-hint">
            Get one at{" "}
            <a className="underline underline-offset-2 hover:text-ink" href="https://pc.0g.ai" target="_blank" rel="noreferrer">
              pc.0g.ai
            </a>
            . It's checked with 0G before it's kept.
          </p>
        )}
      </div>
    </Sheet>
  );
}
