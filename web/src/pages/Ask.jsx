import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams, Navigate } from "react-router-dom";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { api, sha256hex, remaining, DOMAIN, TYPES, STATEMENTS, short, timeAgo } from "../lib/askonly.js";
import { ANY_TOPIC } from "../lib/questions.js";
import ConnectButton from "../components/ConnectButton.jsx";
import { Fact, PageHead, Reading, Rise, useNow } from "../components/ui.jsx";

const QUESTION_MAX = 120;
/* What the network stores is 128 bytes, not characters. Counting characters let a
 * question in Hindi be signed and then refused for its length. */
const QUESTION_BYTES = 128;
const sizeOf = (t) => new TextEncoder().encode(t).length;

/* ---------------------------------------------------------- one question -- */

function Receipt({ r }) {
  const [open, setOpen] = useState(false);
  const noEnclave = r.verification === "no-lines-matched";
  const m = String(r.linesSeen ?? "").match(/^(\d+)\/(\d+)$/);
  return (
    <div className="mt-2">
      <button className="link-action" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Receipt
        <ChevronDown size={14} strokeWidth={1.75} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 rounded-[12px] bg-cream p-3">
          {noEnclave ? (
            <p className="m-0 text-[0.75rem] leading-relaxed text-ink-70">
              Nothing was sent to any enclave for this one. The owner's browser replied by itself.
            </p>
          ) : (
            <dl className="m-0 text-[0.75rem]">
              {m && <Fact k="The enclave read" v={m[1] === m[2] ? "the whole document" : `${m[1]} of ${m[2]} lines`} />}
              <Fact k="Enclave" v={short(r.provider, 10, 6)} />
              <Fact k="Running on" v={r.teeType || "unknown"} />
              <Fact k="Took" v={`${(r.latencyMs / 1000).toFixed(1)}s`} />
              <Fact k="0G request" v={short(r.requestId, 10, 6)} />
            </dl>
          )}
          <p className="m-0 mt-2 text-[0.75rem] leading-relaxed text-ink-50">
            This is everything you received. No document, no key, no figures.
          </p>
        </div>
      )}
    </div>
  );
}

const WORD = { yes: "Yes", no: "No", unknown: "Unknown" };

function Asked({ item, ended, answering }) {
  const stale = item.state === "pending" && ended;
  const waiting = item.state === "pending" && !stale;
  // Only an answer that arrives while you're watching lands with a thump. Answers that
  // were already there when the page opened just sit there.
  const watched = useRef(item.state === "pending");
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="border-t border-line px-6 py-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="break-words font-serif text-[1.25rem] leading-[1.25] tracking-[-0.012em]">“{item.question}”</p>
          <p className="mt-0.5 text-[0.8125rem] text-ink-50">
            {item.sending ? "Sending…" : timeAgo(item.askedAt)}
            {waiting && !item.sending && (
              <span className={answering ? "text-seal" : "text-amber"}>
                {answering ? " · their browser is answering" : " · waiting for their browser"}
              </span>
            )}
          </p>
        </div>
        {item.state === "answered" && item.receipt ? (
          <motion.p
            initial={watched.current ? { opacity: 0, scale: 1.5, rotate: -11 } : false}
            animate={{ opacity: 1, scale: 1, rotate: -4 }}
            transition={{ duration: 0.17, ease: [0.55, 0, 1, 0.45] }}
            className={clsx(
              "stamp stamp-lg m-0 shrink-0",
              item.receipt.answer === "yes" && "stamp-yes",
              item.receipt.answer === "no" && "stamp-no",
            )}
          >
            {WORD[item.receipt.answer] ?? item.receipt.answer}
          </motion.p>
        ) : item.state === "refused" ? (
          <span className="stamp stamp-no shrink-0">Turned down</span>
        ) : stale ? (
          <span className="tag shrink-0">Not answered</span>
        ) : (
          <Reading waiting={!answering && !item.sending} />
        )}
      </div>

      {item.state === "answered" && item.receipt && (
        <>
          {item.receipt.band && <p className="mt-1 text-[0.875rem] text-ink-70">{item.receipt.band}</p>}
          {item.receipt.answer === "unknown" && (
            <p className="mt-1 text-[0.8125rem] leading-snug text-ink-50">
              The document doesn't say. Try asking it another way.
            </p>
          )}
          <Receipt r={item.receipt} />
        </>
      )}
      {item.state === "refused" && (
        <p className="mt-1 text-[0.8125rem] leading-snug text-ink-50">
          {item.refusal?.reason === "out-of-scope"
            ? "That's outside what you were allowed to ask about."
            : "The owner turned this down."}{" "}
          You learned nothing about the document.
        </p>
      )}
      {stale && <p className="mt-1 text-[0.8125rem] leading-snug text-ink-50">The permission ended before this got an answer.</p>}
    </motion.li>
  );
}

const SHOWN = 6;

/**
 * Newest on top, with a tally you can read at a glance. Past a handful, the older ones
 * fold into a pile you can open, so a long run of questions never buries the newest.
 * Anything still waiting stays out of the pile.
 */
function Stack({ items, ended, answering }) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => b.askedAt - a.askedAt);
  const isWaiting = (r) => r.state === "pending" && !ended;
  const waiting = sorted.filter(isWaiting).length;
  const answered = sorted.filter((r) => r.state === "answered").length;
  const declined = sorted.filter((r) => r.state === "refused").length;
  const shown = all ? sorted : sorted.filter((r, i) => i < SHOWN || isWaiting(r));
  const folded = sorted.length - shown.length;
  return (
    <>
      <p className="thread-tally">
        <span>{sorted.length} asked</span>
        {waiting > 0 && <span className="is-waiting">{waiting} waiting</span>}
        {answered > 0 && <span>{answered} answered</span>}
        {declined > 0 && <span>{declined} turned down</span>}
      </p>
      <ul className="m-0 list-none p-0">
        {shown.map((r) => (
          <Asked key={r.requestId} item={r} ended={ended} answering={answering} />
        ))}
      </ul>
      {folded > 0 && (
        <div className="pile-wrap">
          <button type="button" className="pile" onClick={() => setAll(true)}>
            {folded} earlier {folded === 1 ? "question" : "questions"}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------- the composer -- */

/* Your wallet signs once per permission, not once per question. That one signature
 * lets a key kept in this browser sign questions under exactly this permission until
 * it ends, and each question is then signed by that key with no popup. The key can do
 * nothing you could not already do, and the record of every question carries your
 * wallet's signature over it. */
const askKeyName = (grantId, address) => `askonly.askkey.${grantId}.${String(address).toLowerCase()}`;

function heldAskKey(grantId, address, diesAt) {
  try {
    const v = JSON.parse(localStorage.getItem(askKeyName(grantId, address)) ?? "null");
    if (v && v.diesAt === diesAt && diesAt > Date.now()) return { account: privateKeyToAccount(v.privateKey), sig: v.sig };
  } catch {
    /* unreadable, so a new one gets signed */
  }
  return null;
}

/** Keys for permissions that have ended are no use to anyone. */
function dropEndedAskKeys() {
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const k = localStorage.key(i);
    if (!k?.startsWith("askonly.askkey.")) continue;
    try {
      if (!(JSON.parse(localStorage.getItem(k))?.diesAt > Date.now())) localStorage.removeItem(k);
    } catch {
      localStorage.removeItem(k);
    }
  }
}

function Composer({ grantId, onSending, onSent, onFailed }) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  // The thread's own query, from the cache. The key is tied to this permission's end.
  const { data: grant } = useQuery({
    queryKey: ["grant", grantId],
    queryFn: () => api(`/api/grant?id=${grantId}`),
    refetchInterval: 5000,
    retry: false,
  });
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyed, setKeyed] = useState(false);
  const box = useRef(null);
  const text = question.trim();
  const size = sizeOf(text);
  const tooLong = size > QUESTION_BYTES;
  const diesAt = grant?.diesAt;

  useEffect(() => {
    dropEndedAskKeys();
    setKeyed(Boolean(address && diesAt && heldAskKey(grantId, address, diesAt)));
  }, [grantId, address, diesAt]);

  async function ask() {
    if (!text || busy || tooLong || !diesAt) return;
    setBusy(true);
    let signed;
    let questionHash;
    let askedAt;
    try {
      questionHash = await sha256hex(text);
      let key = heldAskKey(grantId, address, diesAt);
      if (!key) {
        // The only wallet popup for this permission.
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);
        const sig = await signTypedDataAsync({
          domain: DOMAIN,
          types: { AskKey: TYPES.AskKey },
          primaryType: "AskKey",
          message: { grantId, sessionKey: account.address, diesAt: BigInt(diesAt), statement: STATEMENTS.askKey },
        });
        localStorage.setItem(askKeyName(grantId, address), JSON.stringify({ privateKey, sig, diesAt }));
        key = { account, sig };
        setKeyed(true);
      }
      askedAt = Date.now();
      // Signed before being told anything. You cannot learn the answer without leaving
      // a record that you asked.
      const askerSig = await key.account.signTypedData({
        domain: DOMAIN,
        types: { Request: TYPES.Request },
        primaryType: "Request",
        message: { grantId, questionHash, askedAt: BigInt(askedAt), statement: STATEMENTS.request },
      });
      signed = { askerKey: key.account.address, askKeySig: key.sig, askerSig };
    } catch (e) {
      toast.error(e.shortMessage ?? e.message);
      setBusy(false);
      return;
    }

    /* Signed, so it is on its way, and the box is free for the next question at once.
     * Recording it takes a few seconds and nobody needs to sit and watch that. */
    const id = `sending-${askedAt}`;
    onSending({ requestId: id, question: text, askedAt, state: "pending", sending: true });
    setQuestion("");
    setBusy(false);
    box.current?.focus();
    try {
      await api("/api/request", {
        body: { grantId, questionHash, askedAt, asker: address, ...signed, question: text },
      });
      onSent(id);
    } catch (e) {
      // A key the server would not take is no use. The next question signs a fresh one.
      if (e.status === 401) {
        localStorage.removeItem(askKeyName(grantId, address));
        setKeyed(false);
      }
      toast.error(e.shortMessage ?? e.message);
      setQuestion((q) => q || text); // put it back rather than lose what they wrote
      onFailed(id);
    }
  }

  return (
    <div className="p-6">
      <label className="sr-only" htmlFor="ask-box">Your question</label>
      <textarea
        id="ask-box"
        ref={box}
        className="input text-[1.0625rem] leading-snug"
        rows={2}
        autoFocus
        maxLength={QUESTION_MAX}
        placeholder="Ask anything with a yes or no answer"
        value={question}
        // One line: a line break is refused, because it could write its own topic line.
        onChange={(e) => setQuestion(e.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            ask();
          }
        }}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-ink-50">
          {tooLong
            ? "That's too long to store. Shorten it a little."
            : size > QUESTION_BYTES - 24
              ? "That's nearly as long as a question can be."
              : keyed
                ? "Ask as many as you like. No need to wait for an answer first."
                : "Your wallet signs once. After that, questions go straight through."}
        </p>
        <button className="btn btn-primary" onClick={ask} disabled={busy || !text || tooLong || !diesAt}>
          {busy ? (keyed ? "Sending…" : "Check your wallet…") : keyed ? "Ask" : "Sign and ask"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ one permission -- */

function Thread({ grantId }) {
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();
  const now = useNow(1000);
  const [sending, setSending] = useState([]); // signed, and still being recorded

  const { data: grant, error: grantErr, isLoading } = useQuery({
    queryKey: ["grant", grantId],
    queryFn: () => api(`/api/grant?id=${grantId}`),
    refetchInterval: 5000,
    retry: false,
  });
  const { data: thread } = useQuery({
    queryKey: ["thread", grantId],
    queryFn: () => api(`/api/requests?grant=${grantId}`),
    refetchInterval: (q) => (q.state.data?.requests?.some((r) => r.state === "pending") ? 2000 : 10_000),
  });

  const requests = thread?.requests ?? [];
  const waiting = requests.filter((r) => r.state === "pending").length;
  const gone = grantErr?.status === 404;

  if (isLoading) return <Centered title="Opening…" />;
  if (gone && !requests.length) {
    return (
      <Centered title={<>This permission <span className="italic">has ended.</span></>}>
        Once its time is up the network stops returning it, and every operation on it fails. There was
        nothing to delete, and nobody had to remember to.
      </Centered>
    );
  }
  if (!grant && !gone) {
    return (
      <Centered title="Couldn't load this permission">
        It's being tried again every few seconds. If this stays, check your connection.
      </Centered>
    );
  }

  const revoked = grant?.state === "revoked";
  const expired = Boolean(grant) && grant.diesAt <= now;
  const ended = gone || revoked || expired;
  const inFlight = sending.filter((x) => !requests.some((r) => r.question === x.question && r.askedAt >= x.askedAt - 60_000));
  // Every question counts, whatever came back, so the thread is the honest count.
  const used = grant ? Math.max(grant.usesSpent + waiting, requests.length) + inFlight.length : 0;
  const left = grant ? Math.max(0, grant.usesAllowed - used) : 0;
  const mine = isConnected && grant && address?.toLowerCase() === grant.verifier?.toLowerCase();
  const items = [...inFlight, ...requests];
  const limited = grant?.note && grant.note !== ANY_TOPIC;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6 sm:px-8 sm:py-10">
      <Link to="/shared" className="link-action mb-4">
        <ArrowLeft size={14} strokeWidth={1.75} /> Shared with me
      </Link>

      <Rise>
        <section className="tile-forest p-8">
          <h1 className="text-[clamp(1.875rem,1.5rem+1.4vw,2.75rem)] leading-[1.08]">
            {!grant ? (
              <>This permission <span className="italic">has ended</span></>
            ) : limited ? (
              <>You can ask about <span className="italic">{grant.note}</span></>
            ) : (
              <>Ask anything <span className="italic">about this document</span></>
            )}
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-on-forest-2">
            Yes, no or unknown comes back. You never see the document.
          </p>
          {grant && (
            <p className="mt-5 font-mono tnum text-[0.8125rem] text-on-forest-2">
              From {short(grant.owner, 6, 4)}
              {!ended && ` · ${remaining(grant.diesAt).text} left`}
            </p>
          )}
        </section>
      </Rise>

      <Rise i={1} className="mt-4">
        <section className="tile">
          {ended ? (
            <p className="p-6 text-[0.9375rem] leading-relaxed text-ink-70">
              {revoked
                ? "The owner ended this permission, so you can't ask anything more."
                : "This permission has run out, so you can't ask anything more."}
            </p>
          ) : !isConnected ? (
            <div className="flex flex-wrap items-center justify-between gap-4 p-6">
              <p className="max-w-[40ch] text-[0.9375rem] leading-relaxed text-ink-70">
                Connect the wallet this was issued to,{" "}
                <span className="font-mono text-[0.875rem]">{short(grant.verifier, 6, 4)}</span>, to ask.
              </p>
              <ConnectButton size="lg" />
            </div>
          ) : !mine ? (
            <p className="p-6 text-[0.9375rem] leading-relaxed text-ink-70">
              This link is for <span className="font-mono text-[0.875rem]">{short(grant.verifier, 6, 4)}</span>, and
              you're connected as <span className="font-mono text-[0.875rem]">{short(address, 6, 4)}</span>. Switch
              accounts in your wallet to ask.
            </p>
          ) : left === 0 ? (
            <p className="p-6 text-[0.9375rem] leading-relaxed text-ink-70">
              That's the most this permission allows. Answers to anything still open will land below.
            </p>
          ) : (
            <Composer
              grantId={grantId}
              onSending={(item) => setSending((list) => [item, ...list])}
              onSent={async (id) => {
                await qc.invalidateQueries({ queryKey: ["thread", grantId] });
                qc.invalidateQueries({ queryKey: ["grant", grantId] });
                setSending((list) => list.filter((x) => x.requestId !== id));
              }}
              onFailed={(id) => setSending((list) => list.filter((x) => x.requestId !== id))}
            />
          )}

          {/* Only worth a word when it changes what you should expect. */}
          {!ended && mine && grant && !grant.answering && (
            <p className="flex items-start gap-2 border-t border-line px-6 py-3 text-[0.8125rem] leading-snug text-ink-50">
              <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-[#c49a4a]" />
              Their browser is closed right now. Ask anyway: your questions wait, and get answered as soon as it's open.
            </p>
          )}

          {items.length > 0 && <Stack items={items} ended={ended} answering={Boolean(grant?.answering)} />}
        </section>
      </Rise>
    </div>
  );
}

/* ------------------------------------------------------- what you've been given -- */

export function Shared() {
  const { address, isConnected } = useAccount();
  const navigate = useNavigate();
  const [pasted, setPasted] = useState("");
  const now = useNow(30_000);

  const { data } = useQuery({
    queryKey: ["given", address],
    queryFn: () => api(`/api/grants?verifier=${address}`),
    enabled: isConnected,
    refetchInterval: 15_000,
  });

  const grants = (data?.grants ?? []).filter((g) => g.state === "live" && g.diesAt > now);
  const found = pasted.match(/grant=(g-[0-9a-f]+)/i)?.[1] ?? pasted.match(/^\s*(g-[0-9a-f]+)\s*$/i)?.[1];

  useEffect(() => {
    if (found) navigate(`/ask?grant=${found}`);
  }, [found, navigate]);

  return (
    <div className="mx-auto max-w-[1040px] px-4 py-6 sm:px-8 sm:py-10">
      <PageHead kicker="AskOnly / for you to ask" title="Shared with me" lead="Documents other people have let you ask about. You get answers, never the file." />

      <Rise>
        <section className="tile">
          {!isConnected ? (
            <div className="flex flex-wrap items-center justify-between gap-4 p-6">
              <p className="text-[0.9375rem] text-ink-70">Connect your wallet to see what's been shared with you.</p>
              <ConnectButton />
            </div>
          ) : grants.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-serif text-[1.5rem] leading-[1.2] tracking-[-0.015em]">Nothing shared with you yet</p>
              <p className="mx-auto mt-2 max-w-[42ch] text-[0.9375rem] leading-relaxed text-ink-50">
                When someone adds {short(address, 6, 4)} as a reviewer, it shows up here.
              </p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {grants.map((g) => (
                <li key={g.grantId} className="border-t border-line first:border-t-0">
                  <Link
                    to={`/ask?grant=${g.grantId}`}
                    className="flex items-center justify-between gap-4 rounded-[20px] px-6 py-5 transition-colors hover:bg-cream"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-serif text-[1.375rem] leading-[1.2] tracking-[-0.015em]">
                        {g.note && g.note !== ANY_TOPIC ? g.note : "A document"}
                      </span>
                      <span className="mt-1 block font-mono tnum text-[0.75rem] text-ink-50">
                        From {short(g.owner, 6, 4)} · {remaining(g.diesAt).text} left
                      </span>
                    </span>
                    <ArrowRight size={18} strokeWidth={1.6} className="shrink-0 text-ink-50" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Rise>

      <Rise i={1} className="mt-4 px-1">
        <label className="eyebrow block" htmlFor="paste-link">Got a link instead? Paste it here</label>
        <input
          id="paste-link"
          className="input mt-2 max-w-[520px] font-mono text-[0.8125rem]"
          placeholder={`${location.origin}/ask?grant=g-…`}
          spellCheck={false}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
      </Rise>
    </div>
  );
}

function Centered({ title, children }) {
  return (
    <div className="mx-auto max-w-[560px] px-5 py-28 text-center">
      <h1 className="text-[clamp(2rem,1.6rem+1.8vw,3rem)] leading-[1.05]">{title}</h1>
      {children && <p className="mx-auto mt-5 max-w-[44ch] text-[0.9375rem] leading-relaxed text-ink-70">{children}</p>}
    </div>
  );
}

export default function Ask() {
  const [params] = useSearchParams();
  const grantId = params.get("grant");
  return grantId ? <Thread key={grantId} grantId={grantId} /> : <Navigate to="/shared" replace />;
}
