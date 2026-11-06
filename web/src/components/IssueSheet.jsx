import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";

import { api, TYPES, STATEMENTS, short } from "../lib/askonly.js";
import { ANY_TOPIC, guessTopic } from "../lib/questions.js";
import { useAnswering } from "../lib/answering.jsx";
import { useSessions } from "../lib/session.js";
import Sheet from "./Sheet.jsx";
import { PassField, Segmented } from "./ui.jsx";

const BLANK = { vaultId: "", verifier: "", verifierName: "", scope: "", life: "d:1", pass: "", key: "" };
const SCOPE_MAX = 120;

/* Only for a server from before the count was dropped. A permission lasts for its time
 * and nothing else; the server rate-limits questions to protect the enclave credit. */
const QUESTIONS_PER_PERMISSION = 100;

const LIFE_TEXT = { "m:2": "2 minutes", "m:10": "10 minutes", "m:60": "hour", "d:1": "day", "d:7": "week" };

/**
 * Add a reviewer. This is the only decision the owner ever makes about them.
 *
 * Who, and for how long. The one signature grants the right AND names the key in this
 * browser that answers under it, so from here on every question is answered with
 * nothing for the owner to do, until the time runs out or they end it. There used to
 * be a second step called "On call", and before that a click for every question.
 */
export default function IssueSheet({ open, initialVaultId, presetPass, vaults, onClose }) {
  const { address } = useAccount();
  const { signedIn, signAndSend } = useSessions();
  const qc = useQueryClient();
  const { unlock, commit, abandon, isUnlocked, hasKey, saveKey } = useAnswering();

  const [g, setG] = useState(BLANK);
  const [limiting, setLimiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { link, name, life }
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setG({ ...BLANK, vaultId: initialVaultId ?? vaults[0]?.vaultId ?? "", pass: presetPass ?? "" });
    setLimiting(false);
    setDone(null);
    setCopied(false);
  }, [open, initialVaultId, presetPass]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = vaults.find((v) => v.vaultId === g.vaultId)?.label ?? "this document";
  const verifier = g.verifier.trim();
  const addressOk = /^0x[0-9a-fA-F]{40}$/.test(verifier);
  const isSelf = addressOk && verifier.toLowerCase() === address?.toLowerCase();
  const unlocked = isUnlocked(g.vaultId);
  // The passphrase carried over from sealing is for that document only.
  const needsPass = !unlocked && !(presetPass && g.vaultId === initialVaultId);
  const ready = g.vaultId && addressOk && !isSelf && (unlocked || g.pass) && (hasKey || g.key.trim());

  async function copy(link) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false); // the link is on screen to copy by hand
    }
  }

  const close = () => {
    setG(BLANK);
    onClose();
  };

  async function issue() {
    if (!ready || busy) return;
    const [unit, n] = g.life.split(":");
    const diesAt = Date.now() + (unit === "m" ? Number(n) * 60_000 : Number(n) * 86_400_000);
    const scope = (limiting && g.scope.trim()) || ANY_TOPIC;
    const questionSet = guessTopic(scope) ?? "general";
    const name = g.verifierName.trim() || short(verifier, 6, 4);
    setBusy(true);
    let opened = false;
    try {
      if (g.key.trim()) {
        const problem = await saveKey(g.key);
        if (problem) throw new Error(problem);
      }
      // Opened first, so a wrong passphrase fails before any wallet popup.
      const sessionKey = await unlock({ vaultId: g.vaultId, label, pass: g.pass });
      opened = true;
      // The server verifies this before it spends its own gas. It can pay for a
      // permission but cannot author one. This browser's session signs it, so there is
      // no wallet popup unless nothing has been signed here this week.
      const counted = TYPES.Grant.some((f) => f.name === "usesAllowed"); // an older server
      const res = await signAndSend(
        {
          types: { Grant: TYPES.Grant },
          primaryType: "Grant",
          message: {
            vaultId: g.vaultId,
            verifier,
            questionSet,
            question: scope,
            ...(counted ? { usesAllowed: BigInt(QUESTIONS_PER_PERMISSION) } : {}),
            diesAt: BigInt(diesAt),
            sessionKey,
            statement: STATEMENTS.grant,
          },
        },
        ({ sig, session }) =>
          api("/api/grant", {
            body: {
              vaultId: g.vaultId,
              owner: address,
              verifier,
              verifierName: name,
              questionSet,
              question: scope,
              ...(counted ? { usesAllowed: QUESTIONS_PER_PERMISSION } : {}),
              diesAt,
              sessionKey,
              threshold: "",
              ownerSig: sig,
              session,
              minutes: unit === "m" ? Number(n) : null,
              days: unit === "d" ? Number(n) : null,
            },
          }),
      );
      const kept = await commit(g.vaultId, { until: diesAt });
      opened = false;
      const link = `${location.origin}/ask?grant=${res.grantId}`;
      await copy(link);
      setDone({ link, name, life: LIFE_TEXT[g.life], kept });
      setG((v) => ({ ...v, pass: "" }));
      qc.invalidateQueries({ queryKey: ["grants", address] });
    } catch (err) {
      if (opened) abandon(g.vaultId);
      toast.error(err.shortMessage ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet
        open={open}
        onClose={close}
        title="Send them this link"
        subtitle={`Only ${done.name}'s wallet can ask with it.`}
        footer={<button className="btn btn-primary btn-lg w-full" onClick={close}>Done</button>}
      >
        <div className="space-y-4">
          <div className="tile flex items-center gap-2 p-2 pl-4">
            <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">{done.link}</span>
            <button className="btn btn-sm shrink-0" onClick={() => copy(done.link)}>
              {copied ? <Check size={14} /> : <Copy size={14} strokeWidth={1.75} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="px-1 text-[0.9375rem] leading-relaxed text-ink-70">
            That's everything. For the next {done.life}, your browser answers {done.name} by itself. You
            won't be asked about any of their questions.
          </p>
          <p className="px-1 text-[0.8125rem] leading-relaxed text-ink-50">
            Keep AskOnly open in a tab with your wallet connected, even in the background. If it's closed,
            their questions wait and get answered when you're back.
          </p>
          {done.kept === false && (
            <p className="px-1 text-[0.8125rem] leading-relaxed text-clay">
              This browser couldn't keep the key it named. Open Reviewers and unlock the document there to
              answer them.
            </p>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add a reviewer"
      subtitle="They can ask about this document until the time runs out. You won't have to do anything else."
      footer={
        <button className="btn btn-primary btn-lg w-full" onClick={issue} disabled={busy || !ready}>
          {busy ? (signedIn ? "Getting the link…" : "Check your wallet…") : signedIn ? "Get the link" : "Sign and get the link"}
        </button>
      }
    >
      <div className="space-y-5">
        {vaults.length > 1 ? (
          <div>
            <label className="field-label" htmlFor="issue-doc">Document</label>
            <select
              id="issue-doc"
              className="input"
              value={g.vaultId}
              onChange={(e) =>
              setG({ ...g, vaultId: e.target.value, pass: e.target.value === initialVaultId ? (presetPass ?? "") : "" })
            }
            >
              {vaults.map((v) => <option key={v.vaultId} value={v.vaultId}>{v.label}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <p className="field-label">Document</p>
            <p className="font-serif text-[1.25rem] leading-[1.2] tracking-[-0.012em]">{label}</p>
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="issue-addr">Their wallet address</label>
          <input
            id="issue-addr"
            className={clsx("input font-mono text-[0.8125rem]", g.verifier && (!addressOk || isSelf) && "input-bad")}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            value={g.verifier}
            onChange={(e) => setG({ ...g, verifier: e.target.value })}
          />
          {g.verifier && (!addressOk || isSelf) && (
            <p className="field-hint !text-clay">
              {isSelf ? "That's your own address. Use the other person's." : "That isn't a complete address yet."}
            </p>
          )}
        </div>

        <div>
          <label className="field-label" htmlFor="issue-name">Their name <span className="text-ink-50">(optional)</span></label>
          <input
            id="issue-name"
            className="input"
            placeholder="Landlord"
            value={g.verifierName}
            onChange={(e) => setG({ ...g, verifierName: e.target.value })}
          />
          <p className="field-hint">
            Kept on a public network, with what they ask and what comes back. The document never is.
          </p>
        </div>

        <Segmented
          label="For how long"
          value={g.life}
          onChange={(life) => setG({ ...g, life })}
          options={[
            { value: "m:2", label: "2 min" },
            { value: "m:10", label: "10 min" },
            { value: "m:60", label: "1 hour" },
            { value: "d:1", label: "1 day" },
            { value: "d:7", label: "7 days" },
          ]}
        />

        {needsPass && (
          <div>
            <PassField
              value={g.pass}
              onChange={(pass) => setG({ ...g, pass })}
              placeholder="The one you sealed it with"
              label="Your passphrase"
              onEnter={issue}
            />
            <p className="field-hint">Only used here, to open the document in this browser. It's never sent.</p>
          </div>
        )}

        {!hasKey && (
          <div>
            <label className="field-label" htmlFor="issue-key">Your 0G API key</label>
            <input
              id="issue-key"
              className="input font-mono text-[0.8125rem]"
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              value={g.key}
              onChange={(e) => setG({ ...g, key: e.target.value })}
            />
            <p className="field-hint">
              Your browser calls the enclave directly with this, so it only ever goes to 0G. Get one at{" "}
              <a className="underline underline-offset-2 hover:text-ink" href="https://pc.0g.ai" target="_blank" rel="noreferrer">pc.0g.ai</a>.
            </p>
          </div>
        )}

        <div>
          <button
            type="button"
            className="link-action"
            aria-expanded={limiting}
            onClick={() => setLimiting((v) => !v)}
          >
            Limit what they can ask about
            <ChevronDown size={14} strokeWidth={1.75} className={clsx("transition-transform", limiting && "rotate-180")} />
          </button>
          {limiting && (
            <div className="mt-2">
              <textarea
                className="input leading-snug"
                rows={2}
                maxLength={SCOPE_MAX}
                autoFocus
                placeholder="whether I earn enough to cover the rent"
                value={g.scope}
                onChange={(e) => setG({ ...g, scope: e.target.value })}
              />
              <p className="field-hint">Anything clearly outside this gets turned down automatically.</p>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
