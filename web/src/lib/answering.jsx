/**
 * AskOnly — answering by itself.
 *
 * Why anything of the owner's has to be involved: the document is encrypted with
 * their passphrase and nobody else holds it, so only their browser can turn it back
 * into text. That is the product. It does NOT follow that a person has to do anything
 * for each question, and for most of this project's life they did.
 *
 * The model: permission is decided once, when you add a reviewer. That one signature
 * names a key held in this browser, so every answer until the permission ends is signed
 * by that key with nothing to click. There is no switch to turn on.
 *
 * What it will not do is take the server's word for anything it pays to answer. Before a
 * question costs anything, the owner's own signature over the permission and the asker's
 * over the question are checked here, so a server that invents a question, or widens a
 * topic, gets nothing answered.
 *
 * Nor does it hand the enclave more than it needs. Each question starts with the
 * narrowest extract, and only widens if that cannot settle it.
 *
 * Where this differs from a person answering, and why it has to:
 *   - Nobody reads the question first, so the owner's own words for what they allowed
 *     travel with it, as they signed them, and the enclave keeps it to that.
 *   - A failure must never become a paid call every 2.5 seconds, so two attempts and
 *     then it is left for later. A stage already paid for is never paid for again, and
 *     recording an answer already bought costs nothing, so that keeps trying by itself.
 *   - An overloaded enclave is not a failure. Nothing was read and nothing was spent,
 *     so everything waits as long as 0G asks and then carries on by itself.
 *
 * It lives above the routes so that changing page does not stop it. The decrypted text
 * is in a ref, never a store. What survives a reload is described in keystore.js.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import {
  api, openDocument, decryptWithKey, askEnclaveDirect, noMatchAnswer, checkZeroGKey,
  signedByOwner, signedByAsker, DOMAIN, TYPES, STATEMENTS,
} from "./askonly.js";
import { extractStages, enclaveRequest, NEEDS_WIDENING, isAnyTopic } from "./questions.js";
import { allSessions, putSession, removeSession, wrapSecret, unwrapSecret } from "./keystore.js";

const POLL_MS = 2500;
const PRESENCE_EVERY_MS = 10_000;
const MAX_TRIES = 2; // calling the enclave costs the owner money
const MAX_RECORD_TRIES = 8; // recording an answer we already have does not
const RESTORE_RETRY_MS = 10_000;
const REAP_GRACE_MS = 60_000; // a permission just issued may not be listed yet
const KEY_STORE = "askonly.0g";
const CHANNEL = "askonly-sessions";

export const zeroGKey = () => localStorage.getItem(KEY_STORE) ?? "";

/** One source of truth for what is waiting, shared with every screen that shows it. */
export const inboxQuery = (owner) => ({
  queryKey: ["inbox", owner],
  queryFn: () => api(`/api/inbox?owner=${owner}`),
});

export const grantsQuery = (owner) => ({
  queryKey: ["grants", owner],
  queryFn: () => api(`/api/grants?owner=${owner}`),
});

const usable = (g) => g.state === "live" && g.diesAt > Date.now() && g.usesSpent < g.usesAllowed;
const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/** A delegation counts only while it lasts. An expired one used to be sent anyway. */
const liveDelegation = (s) => (s?.delegation && s.delegation.diesAt * 1000 > Date.now() ? s.delegation : null);
/** The key in this browser that a permission names, if any. */
const namedBy = (g, s) => (g?.sessionKey ? s.accounts.find((a) => same(a.address, g.sessionKey)) : undefined);

/** Why a question was left unanswered, in words for the owner. */
const UNTRUSTED = {
  grant:
    "Its terms don't match what you signed, so it wasn't answered. A reviewer added before this update has to be added again.",
  request: "It isn't signed by the person you let ask, so it wasn't answered.",
};

/* A hidden tab has its timers throttled to about once a minute. A worker's are not,
 * and "keep this tab open" has to include "in the background". */
function everyTick(ms, fn) {
  try {
    const url = URL.createObjectURL(
      new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    worker.onmessage = fn;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

/** The wrapped keys in a record, each with its address. Older records held one. */
async function wrapsOf(rec) {
  if (rec.wraps?.length) return rec.wraps;
  if (!rec.wrapped) return [];
  const account = privateKeyToAccount(await unwrapSecret(rec.key, rec.wrapped));
  return [{ address: account.address, wrapped: rec.wrapped }];
}

/* Kept across a hot reload. This module re-evaluates when anything it imports changes,
 * and a new context object strands every consumer: the hook below then throws, and the
 * whole app went white while anyone edited questions.js. */
const Ctx = import.meta.hot?.data.ctx ?? createContext(null);
if (import.meta.hot) import.meta.hot.data.ctx = Ctx;

export function AnsweringProvider({ children }) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const qc = useQueryClient();

  const [sessions, setSessions] = useState([]); // { vaultId, label, sessionKey, owner }
  const [rows, setRows] = useState({}); // requestId -> { state: "answering" | "failed", detail }
  const [hasKey, setHasKey] = useState(() => Boolean(zeroGKey()));
  const [keyProblem, setKeyProblem] = useState(null); // why the 0G key stopped working
  const [restoring, setRestoring] = useState(true);

  /* vaultId -> { plaintext, key, owner, label, accounts, wraps, delegation, persisted,
   *              pins, until, committedAt }
   * `accounts` is every key this browser holds for the document. One per document was
   * the old model, and a second tab making its own replaced the first on disk, which
   * stranded every permission that named it. */
  const secrets = useRef(new Map());
  const attempts = useRef(new Map()); // requestId -> failures so far
  const paidFor = useRef(new Map()); // requestId -> the enclave's final result
  const stagesDone = useRef(new Map()); // requestId -> { next, last, latencyMs }, partway
  const claimed = useRef(new Set()); // requestIds this tab has taken, or given up on
  const keyFailed = useRef(new Set()); // requestIds that failed only for want of a key
  const trusted = useRef(new Map()); // "g:id" | "q:id" -> Promise<boolean>
  const working = useRef(false);
  const lastPing = useRef(0);
  const coolUntil = useRef(0); // the enclave is overloaded: nothing goes to it before this
  const notBefore = useRef(new Map()); // requestId -> don't retry recording it until then
  const kick = useRef(() => {});
  const owner = useRef(address); // whose records the restore loop may load
  const channel = useRef(null);

  const { data: grantData } = useQuery({
    ...grantsQuery(address),
    enabled: Boolean(address),
    refetchInterval: 15_000,
  });

  const setRow = useCallback((id, row) => {
    setRows((r) => {
      const next = { ...r };
      if (row) next[id] = row;
      else delete next[id];
      return next;
    });
  }, []);

  const show = useCallback((vaultId, s) => {
    setSessions((list) => [
      ...list.filter((x) => x.vaultId !== vaultId),
      { vaultId, label: s.label, sessionKey: s.accounts[0].address, owner: s.owner },
    ]);
  }, []);

  /** Keep a 0G key once 0G has said it knows it. Resolves to why not, or null. */
  const saveKey = useCallback(async (k) => {
    const v = String(k ?? "").trim();
    if (!v) {
      localStorage.removeItem(KEY_STORE);
      setHasKey(false);
      return null;
    }
    if (!(await checkZeroGKey(v))) return "0G doesn't recognise that key. Check it at pc.0g.ai.";
    localStorage.setItem(KEY_STORE, v);
    setHasKey(true);
    setKeyProblem(null);
    // Whatever failed only because the key did gets another go, by itself.
    for (const id of keyFailed.current) {
      claimed.current.delete(id);
      attempts.current.delete(id);
      setRow(id, null);
    }
    keyFailed.current.clear();
    kick.current();
    return null;
  }, [setRow]);

  /** Forget a document's keys, in this tab, on disk, and in every other tab. */
  const stop = useCallback((vaultId) => {
    const s = secrets.current.get(vaultId);
    secrets.current.delete(vaultId);
    setSessions((list) => list.filter((x) => x.vaultId !== vaultId));
    removeSession(vaultId).catch(() => {});
    if (s) channel.current?.postMessage({ type: "stop", vaultId, owner: s.owner });
  }, []);

  /* -------------------------------------------------- loading from disk --- */

  /** A record on disk, opened: the document decrypted and every key unwrapped. */
  const load = useCallback(async (rec) => {
    const vault = await api(`/api/vault?id=${encodeURIComponent(rec.vaultId)}`);
    const plaintext = await decryptWithKey(vault.cipher, vault.iv, rec.key);
    const wraps = await wrapsOf(rec);
    const accounts = [];
    for (const w of wraps) accounts.push(privateKeyToAccount(await unwrapSecret(rec.key, w.wrapped)));
    if (!accounts.length) throw new DOMException("this record holds no key");
    return {
      plaintext, key: rec.key, owner: rec.owner, label: rec.label, accounts, wraps,
      delegation: rec.delegation ?? null, persisted: true, pins: 0, until: rec.until ?? 0, committedAt: 0,
    };
  }, []);

  /**
   * Bring this owner's records into memory: after a reload, when this tab takes over
   * answering, and when another tab says it kept something. A key already here is kept,
   * and any this tab has not seen is added. Resolves to the ones that could not be read
   * for a reason that may pass, such as the network.
   */
  const restore = useCallback(async (who, only = null) => {
    const records = await allSessions().catch(() => []);
    const failed = [];
    for (const rec of records) {
      // Checked after every wait: a wallet switched mid-way must not inherit any of this.
      if (owner.current !== who) return { stale: true, failed };
      if (rec.owner !== who || (only && rec.vaultId !== only)) continue;
      if (rec.until && rec.until < Date.now()) {
        removeSession(rec.vaultId).catch(() => {}); // everything it served has ended
        continue;
      }
      try {
        const held = secrets.current.get(rec.vaultId);
        if (held) {
          for (const w of await wrapsOf(rec)) {
            if (held.accounts.some((a) => same(a.address, w.address))) continue;
            held.accounts.push(privateKeyToAccount(await unwrapSecret(rec.key, w.wrapped)));
            held.wraps.push(w);
          }
          held.delegation ??= rec.delegation ?? null;
          held.until = Math.max(held.until ?? 0, rec.until ?? 0);
          held.persisted = true;
          continue;
        }
        const s = await load(rec);
        if (owner.current !== who) return { stale: true, failed };
        secrets.current.set(rec.vaultId, s);
        show(rec.vaultId, s);
      } catch (e) {
        // The document is gone or the record is unusable. A network blip is not a
        // reason to forget it, so only a definite "no" removes the record.
        if (e?.status === 404 || e instanceof DOMException || /passphrase/.test(e?.message ?? "")) {
          removeSession(rec.vaultId).catch(() => {});
        } else {
          failed.push(rec.vaultId);
        }
      }
    }
    return { stale: false, failed };
  }, [load, show]);

  /* -------------------------------------------------- after a reload ------ */
  useEffect(() => {
    owner.current = address;
    // Keys are one owner's. A different wallet must not inherit anything.
    secrets.current = new Map();
    setSessions([]);
    setRows({});
    for (const m of [claimed, keyFailed]) m.current = new Set();
    for (const m of [attempts, paidFor, stagesDone, trusted, notBefore]) m.current = new Map();
    if (!address) {
      setRestoring(false);
      return undefined;
    }
    setRestoring(true);

    let timer = null;
    let tries = 0;
    const run = async () => {
      const { stale, failed } = await restore(address);
      if (stale || owner.current !== address) return;
      setRestoring(false);
      // A blip at load used to leave the document locked, and unlocking then made a new
      // key that nothing named. Try again quietly instead.
      if (failed.length && tries < 6) {
        tries += 1;
        timer = setTimeout(run, RESTORE_RETRY_MS);
      }
    };
    run();

    // Tabs tell each other when they keep or forget a document's keys.
    const bc = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
    channel.current = bc;
    if (bc) {
      bc.onmessage = ({ data }) => {
        if (!data || data.owner !== address) return;
        if (data.type === "commit") restore(address, data.vaultId).catch(() => {});
        if (data.type === "stop") {
          const s = secrets.current.get(data.vaultId);
          if (s && !s.pins) {
            secrets.current.delete(data.vaultId);
            setSessions((list) => list.filter((x) => x.vaultId !== data.vaultId));
          }
        }
      };
    }
    return () => {
      clearTimeout(timer);
      bc?.close();
      if (channel.current === bc) channel.current = null;
    };
  }, [address, restore]);

  /* -------------------------------------------------- unlocking ----------- */

  /**
   * Have this document open here, and a key ready to name in a permission. Fails on a
   * wrong passphrase, before anything asks the wallet for a signature. The session is
   * pinned until commit() or abandon(), so nothing can clear it while the wallet asks.
   */
  const unlock = useCallback(
    async ({ vaultId, label, pass }) => {
      const held = secrets.current.get(vaultId);
      if (held) {
        held.pins += 1;
        return held.accounts[0].address;
      }
      // Another tab may already keep a key for this document. Use it rather than make
      // a second one that would be saved over it.
      const rec = (await allSessions().catch(() => [])).find((x) => x.vaultId === vaultId && x.owner === address);
      if (rec && !(rec.until && rec.until < Date.now())) {
        const s = await load(rec).catch(() => null);
        if (s) {
          s.pins = 1;
          secrets.current.set(vaultId, s);
          show(vaultId, s);
          lastPing.current = 0;
          return s.accounts[0].address;
        }
      }
      const vault = await api(`/api/vault?id=${encodeURIComponent(vaultId)}`);
      const { plaintext, key } = await openDocument(vault.cipher, vault.iv, pass);
      const privateKey = generatePrivateKey();
      const account = privateKeyToAccount(privateKey);
      const s = {
        plaintext, key, owner: address, label, accounts: [account],
        wraps: [{ address: account.address, wrapped: await wrapSecret(key, privateKey) }],
        delegation: null,
        persisted: false, // nothing depends on it yet, so it stays in memory only
        pins: 1, until: 0, committedAt: 0,
      };
      secrets.current.set(vaultId, s);
      show(vaultId, s);
      lastPing.current = 0;
      return account.address;
    },
    [address, load, show],
  );

  /**
   * A permission now names this browser's key, so keep it, until `until` at the latest.
   * Merged with what is on disk, because another tab may keep a key for it too.
   * Resolves to false if the session was somehow gone.
   */
  const commit = useCallback(async (vaultId, { until = 0 } = {}) => {
    const s = secrets.current.get(vaultId);
    if (!s) return false;
    s.pins = Math.max(0, s.pins - 1);
    s.persisted = true;
    s.committedAt = Date.now();
    s.until = Math.max(s.until ?? 0, until);
    const disk = (await allSessions().catch(() => [])).find((x) => x.vaultId === vaultId && x.owner === s.owner);
    const wraps = [...s.wraps];
    for (const w of disk ? await wrapsOf(disk).catch(() => []) : []) {
      if (!wraps.some((x) => same(x.address, w.address))) wraps.push(w);
    }
    await putSession({
      vaultId, owner: s.owner, label: s.label, key: s.key, wraps,
      delegation: s.delegation ?? disk?.delegation ?? null,
      until: Math.max(s.until, disk?.until ?? 0),
    }).catch(() => {});
    channel.current?.postMessage({ type: "commit", vaultId, owner: s.owner });
    lastPing.current = 0;
    kick.current();
    return true;
  }, []);

  /** The signature was declined. A decrypted document should not sit around for that. */
  const abandon = useCallback((vaultId) => {
    const s = secrets.current.get(vaultId);
    if (!s) return;
    s.pins = Math.max(0, s.pins - 1);
    if (!s.persisted && !s.pins) {
      secrets.current.delete(vaultId);
      setSessions((list) => list.filter((x) => x.vaultId !== vaultId));
    }
  }, []);

  /**
   * For a permission this browser holds no key for: one issued on another device, or
   * before this browser's data was cleared. One signature, good until the last of them ends.
   */
  const unlockWithSignature = useCallback(
    async ({ vaultId, label, pass, diesAtMs }) => {
      await unlock({ vaultId, label, pass });
      const s = secrets.current.get(vaultId);
      const diesAt = Math.ceil(diesAtMs / 1000);
      let sig;
      try {
        sig = await signTypedDataAsync({
          domain: DOMAIN,
          types: { Delegation: TYPES.Delegation },
          primaryType: "Delegation",
          message: {
            vaultId,
            sessionKey: s.accounts[0].address,
            diesAt: BigInt(diesAt),
            statement: STATEMENTS.delegation,
          },
        });
      } catch (e) {
        abandon(vaultId); // declined: nothing depends on it, so it does not stay open
        throw e;
      }
      s.delegation = { owner: address, vaultId, sessionKey: s.accounts[0].address, diesAt, sig };
      await commit(vaultId, { until: diesAtMs });
    },
    [address, signTypedDataAsync, unlock, commit, abandon],
  );

  /* -------------------------------------------------- trusting nothing ---- */

  /** Checked once per permission and once per question, then remembered. */
  const isTrusted = useCallback((key, check) => {
    let p = trusted.current.get(key);
    if (!p) {
      p = check().catch(() => false);
      trusted.current.set(key, p);
    }
    return p;
  }, []);

  /* -------------------------------------------------- answering one ------- */

  /** Ask the enclave, narrowest first. A stage already paid for is not paid for again. */
  const askTheEnclave = useCallback(async (r, s, g) => {
    const scope = g.note; // as the owner signed it, not the server's copy
    const stages = extractStages(s.plaintext, r.question, scope);
    if (!stages.length) return { result: await noMatchAnswer(), kept: 0, total: 0 };
    const key = zeroGKey();
    if (!key) throw Object.assign(new Error("add your 0G key to keep answering"), { keyRejected: true });
    let { next, last, latencyMs } = stagesDone.current.get(r.requestId) ?? { next: 0, last: null, latencyMs: 0 };
    for (let i = next; i < stages.length; i += 1) {
      if (last && (last.result.outOfScope || !NEEDS_WIDENING(last.result))) break;
      const stage = stages[i];
      const result = await askEnclaveDirect(enclaveRequest(r.question, stage.extract, { scope }), key);
      // Nothing is outside "anything". The server's copy already held to this.
      if (isAnyTopic(scope)) result.outOfScope = false;
      latencyMs += result.latencyMs;
      last = { result, kept: stage.keptLines, total: stage.totalLines };
      stagesDone.current.set(r.requestId, { next: i + 1, last, latencyMs });
    }
    // "Took" on the receipt was the last stage alone.
    return { ...last, result: { ...last.result, latencyMs } };
  }, []);

  const answerOne = useCallback(
    async (r, s, g) => {
      const who = s.owner;
      const account = namedBy(g, s) ?? s.accounts[0];
      const delegation = namedBy(g, s) ? null : liveDelegation(s);
      claimed.current.add(r.requestId);
      setRow(r.requestId, { state: "answering" });
      try {
        let got = paidFor.current.get(r.requestId);
        if (!got) {
          got = await askTheEnclave(r, s, g);
          paidFor.current.set(r.requestId, got);
          stagesDone.current.delete(r.requestId);
        }

        const { result, kept, total } = got;
        const refuse = result.outOfScope;
        const answerHash = refuse ? "" : result.answerHash;
        const enclaveRequestId = refuse ? "" : result.enclaveRequestId;

        // Signed by the key in this browser, not the wallet. No popup.
        const ownerSig = await account.signTypedData({
          domain: DOMAIN,
          types: { Answer: TYPES.Answer },
          primaryType: "Answer",
          message: {
            requestId: r.requestId,
            grantId: r.grantId,
            questionHash: r.questionHash,
            answerHash,
            enclaveRequestId,
            statement: STATEMENTS.answer,
          },
        });
        const common = {
          requestId: r.requestId, owner: who, signer: account.address, ownerSig,
          ...(delegation ? { delegation } : {}),
        };
        // Only what the receipt records. The enclave's own reasons stay in this browser.
        await api("/api/answer", {
          body: refuse
            ? { ...common, decision: "refused", reason: "out-of-scope", answerHash: "", enclaveRequestId: "" }
            : {
                ...common, decision: "answered", answer: result.answer, band: result.band, answerHash,
                enclaveRequestId, provider: result.provider, model: result.model, verification: result.verification,
                teeType: result.teeType, latencyMs: result.latencyMs, linesSeen: `${kept}/${total}`,
              },
        });

        paidFor.current.delete(r.requestId);
        setRow(r.requestId, null);
      } catch (e) {
        // Already answered, or the permission ended. Not a failure of ours.
        if (e.status === 404 || e.status === 409 || e.status === 410) {
          paidFor.current.delete(r.requestId);
          stagesDone.current.delete(r.requestId);
          setRow(r.requestId, null);
          return;
        }
        if (e.busy) {
          coolUntil.current = Date.now() + e.retryAfterMs;
          claimed.current.delete(r.requestId);
          setRow(r.requestId, null);
          return;
        }
        if (e.keyRejected) {
          // Every other question would fail the same way, so stop asking until there is
          // a key that works. Saving one sends these round again.
          localStorage.removeItem(KEY_STORE);
          setHasKey(false);
          setKeyProblem(zeroGKey() ? null : "Your 0G key was turned down. Add it again to keep answering.");
          keyFailed.current.add(r.requestId);
          setRow(r.requestId, { state: "failed", detail: "Waiting for a 0G key that works", keyRelated: true });
          return;
        }
        const n = (attempts.current.get(r.requestId) ?? 0) + 1;
        attempts.current.set(r.requestId, n);
        // Refused outright (a bad signature, say): trying again by itself cannot change that.
        const refused = e.status >= 400 && e.status < 500;
        const bought = paidFor.current.has(r.requestId);
        if (!refused && bought && n < MAX_RECORD_TRIES) {
          notBefore.current.set(r.requestId, Date.now() + Math.min(60_000, 2000 * 2 ** n));
          claimed.current.delete(r.requestId);
        } else if (!refused && !bought && n < MAX_TRIES) {
          claimed.current.delete(r.requestId); // one more go, on the next tick
        } else {
          // Stays claimed, so this session never pays for it again unless asked to. An
          // answer already bought is kept, so asking again only costs a write.
          setRow(r.requestId, { state: "failed", detail: String(e.shortMessage ?? e.message).slice(0, 110) });
        }
      } finally {
        qc.invalidateQueries({ queryKey: ["inbox", who] });
        qc.invalidateQueries({ queryKey: ["grants", who] });
        qc.invalidateQueries({ queryKey: ["ledger", who] });
      }
    },
    [askTheEnclave, qc, setRow],
  );

  /* -------------------------------------------------- staying present ----- */
  const announce = useCallback((grants) => {
    let sent = 0;
    for (const [vaultId, s] of secrets.current) {
      const live = grants.filter((x) => x.vaultId === vaultId && usable(x));
      if (!live.length) continue;
      if (liveDelegation(s)) {
        api("/api/presence", { body: { delegation: s.delegation } }).catch(() => {});
        sent += 1;
      }
      // Once for each key a live permission names, so each reviewer sees their own.
      const pinged = new Set();
      for (const g of live) {
        const account = namedBy(g, s);
        if (!account || pinged.has(account.address)) continue;
        pinged.add(account.address);
        sent += 1;
        const at = Date.now();
        account
          .signTypedData({
            domain: DOMAIN,
            types: { Presence: TYPES.Presence },
            primaryType: "Presence",
            message: { grantId: g.grantId, at: BigInt(at) },
          })
          .then((sig) => api("/api/presence", { body: { grantId: g.grantId, at, sessionKey: account.address, sig } }))
          .catch(() => {});
      }
    }
    return sent;
  }, []);

  /* A session lasts exactly as long as a permission it serves: one naming one of its keys,
   * or any on the document while a delegation covers it. There is no switch. */
  const grants = useMemo(() => grantData?.grants ?? [], [grantData]);
  useEffect(() => {
    if (!grantData || restoring || !address) return;
    const serves = (vaultId, s) =>
      grants.some((g) => g.vaultId === vaultId && usable(g) && (namedBy(g, s) || liveDelegation(s)));
    const idle = [...secrets.current].filter(
      ([vaultId, s]) => s.persisted && !s.pins && Date.now() - s.committedAt > REAP_GRACE_MS && !serves(vaultId, s),
    );
    if (!idle.length) return;
    (async () => {
      for (const [vaultId] of idle) {
        // Another tab may have kept a key for it since: read the disk before deciding.
        await restore(address, vaultId).catch(() => {});
        const s = secrets.current.get(vaultId);
        if (s && !s.pins && !serves(vaultId, s)) stop(vaultId);
      }
    })();
  }, [grants, grantData, restoring, address, restore, stop]);

  /* -------------------------------------------------- the loop ------------ */
  const ids = sessions.map((s) => s.vaultId).join(",");
  useEffect(() => {
    if (!address || !ids) return undefined;
    let stopped = false;
    let end = null;
    let release = null;
    let current = null;

    const tick = () => {
      current = (async () => {
        if (stopped) return;
        // A browser with no working key cannot answer, so it does not say it is.
        if (!zeroGKey()) return;
        // Before the busy check. Answering a queue takes a while, and this used to wait
        // for it, so the reviewer read "their browser is closed" at the very moment it
        // was hardest at work.
        if (Date.now() - lastPing.current > PRESENCE_EVERY_MS) {
          if (announce(qc.getQueryData(["grants", address])?.grants ?? [])) lastPing.current = Date.now();
        }
        if (working.current) return;
        working.current = true;
        try {
          const inbox = await qc.fetchQuery({ ...inboxQuery(address), staleTime: 0 });
          // Oldest first, and one at a time: the order they were asked in, and a tick
          // that overlapped the last one used to race it.
          const waiting = [...(inbox?.pending ?? [])].sort((a, b) => a.askedAt - b.askedAt);
          let list = qc.getQueryData(["grants", address])?.grants ?? [];
          if (waiting.some((r) => !list.some((g) => g.grantId === r.grantId))) {
            list = (await qc.fetchQuery({ ...grantsQuery(address), staleTime: 0 }))?.grants ?? list;
          }
          for (const r of waiting) {
            if (stopped || Date.now() < coolUntil.current) return;
            const s = secrets.current.get(r.vaultId);
            if (!s || claimed.current.has(r.requestId)) continue;
            if ((notBefore.current.get(r.requestId) ?? 0) > Date.now()) continue;
            const g = list.find((x) => x.grantId === r.grantId);
            if (!g || g.vaultId !== r.vaultId || !usable(g)) continue;
            // A permission issued elsewhere names a key this tab does not hold, and only a
            // live delegation lets this tab answer for it. Asking anyway would pay the
            // enclave for an answer the server is certain to refuse.
            if (!namedBy(g, s) && !liveDelegation(s)) continue;
            // Nothing is paid for on the server's word alone.
            if (!(await isTrusted(`g:${g.grantId}`, () => signedByOwner(g, s.owner)))) {
              claimed.current.add(r.requestId);
              setRow(r.requestId, { state: "failed", detail: UNTRUSTED.grant, untrusted: true });
              continue;
            }
            if (!(await isTrusted(`q:${r.requestId}`, () => signedByAsker(r, g)))) {
              claimed.current.add(r.requestId);
              setRow(r.requestId, { state: "failed", detail: UNTRUSTED.request, untrusted: true });
              continue;
            }
            await answerOne(r, s, g);
          }
        } catch {
          /* a dropped poll is not news. The next tick tries again. */
        } finally {
          working.current = false;
        }
      })();
      return current;
    };

    const run = async () => {
      // Whatever other tabs kept while this one waited for its turn.
      await restore(address).catch(() => {});
      if (stopped) return;
      kick.current = tick;
      tick();
      end = everyTick(POLL_MS, tick);
    };

    // Two tabs open must not both pay for the same answer. Whichever holds the lock
    // answers, and another takes over by itself, loading from disk, if that tab closes.
    if (navigator.locks?.request) {
      navigator.locks.request(`askonly-answering-${address.toLowerCase()}`, () =>
        new Promise((resolve) => {
          if (stopped) return resolve();
          release = resolve;
          run();
          return undefined;
        }),
      );
    } else {
      run();
    }

    return () => {
      stopped = true;
      end?.();
      kick.current = () => {};
      // A question being answered finishes before another tab may take the lock, or it
      // would pay for the same one.
      Promise.resolve(current).finally(() => release?.());
    };
  }, [address, ids, answerOne, announce, isTrusted, qc, restore, setRow]);

  /** Give one failed question another go, checking everything again. */
  const retry = useCallback(
    (requestId) => {
      attempts.current.delete(requestId);
      claimed.current.delete(requestId);
      notBefore.current.delete(requestId);
      trusted.current.delete(`q:${requestId}`);
      for (const k of [...trusted.current.keys()]) {
        if (k.startsWith("g:")) trusted.current.get(k)?.then((v) => !v && trusted.current.delete(k));
      }
      setRow(requestId, null);
      kick.current();
    },
    [setRow],
  );

  /** Can this tab answer under this permission right now? */
  const answers = useCallback(
    (grant) => {
      if (!sessions.some((x) => x.vaultId === grant.vaultId)) return false;
      const s = secrets.current.get(grant.vaultId);
      return Boolean(s) && (Boolean(namedBy(grant, s)) || Boolean(liveDelegation(s)));
    },
    [sessions],
  );

  const value = useMemo(
    () => ({
      sessions,
      restoring,
      sessionFor: (vaultId) => sessions.find((s) => s.vaultId === vaultId) ?? null,
      isUnlocked: (vaultId) => sessions.some((s) => s.vaultId === vaultId),
      answers,
      rows,
      unlock,
      commit,
      abandon,
      unlockWithSignature,
      stop,
      retry,
      hasKey,
      keyProblem,
      saveKey,
    }),
    [sessions, restoring, answers, rows, unlock, commit, abandon, unlockWithSignature, stop, retry, hasKey, keyProblem, saveKey],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAnswering() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAnswering must be used inside AnsweringProvider");
  return v;
}
