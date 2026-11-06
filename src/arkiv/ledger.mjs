/**
 * AskOnly — the Arkiv ledger: writes and reads.
 *
 * The one idea to hold on to: a grant that has passed its death block is not
 * returned by ANY query and every operation on it fails. So `liveGrant(id)`
 * coming back null is not a missing record - it is the expiry, observed. We
 * never ask "is it expired?"; we ask the network for it and it is simply not there.
 *
 * Reads cost no gas. Writes go through guardedWrite().
 */

import { eq, and, asc, desc } from "@arkiv-network/sdk/query";
import { str, addr, u64, u256, bytes } from "@arkiv-network/sdk/schema";
import { hexToBytes } from "viem";

/* Every value written to Arkiv carries its type tag. The schema does not
 * reinterpret a bare value: a bare JS number is an `i32` and a bare string is a
 * `str`, so an untagged address fails with
 *   Column "owner": a addr column, but the value is a str.
 * Tagging everything - not just the ambiguous ones - keeps that class of bug
 * impossible rather than merely unlikely. */
import { Vault, Grant, Access, Refusal, Request, fitStr, QUESTION_SETS } from "./schema.mjs";
import { guardedWrite, expiry, scrub, safeError, txLink } from "./client.mjs";

const PAGE = 100; // MAX_LIMIT
const now = () => BigInt(Date.now());

/* =========================================================== WRITES ===== */

/** Store an encrypted document. `cipher` arrives already encrypted from the
 *  owner's browser; this process never sees the plaintext or the key. */
export async function putVault(ctx, { owner, label, docKind, sha256, iv, cipher, days = 180 }) {
  const bytesLen = cipher?.length ?? 0;
  if (bytesLen === 0) throw safeError("refusing to store an empty ciphertext");
  if (bytesLen > 128 * 1024) {
    throw safeError(`ciphertext is ${bytesLen} bytes; Arkiv allows 128 KiB per create`);
  }
  const vaultId = `v-${crypto.randomUUID().slice(0, 8)}`;
  const res = await guardedWrite(
    ctx,
    ({ gas }) =>
      ctx.wallet.createEntity(
        Vault,
        {
          vaultId: str(vaultId),
          owner: addr(owner),
          docKind: str(fitStr(docKind)),
          state: str("live"),
          sha256: str(fitStr(sha256)),
          bytesLen: u64(BigInt(bytesLen)),
          createdAt: u64(now()),
          label: str(fitStr(label)),
          iv: str(fitStr(iv)),
          cipher: bytes(cipher),
        },
        { expiration: expiry.days(days) },
        { gas },
      ),
    { label: "putVault" },
  );
  return { vaultId, entityKey: res.entityKey, txHash: res.txHash, tx: txLink(res.txHash), expiresAt: res.expiresAt?.toString(), bytesLen };
}

/**
 * Issue a capability. The `expiration` passed here is the whole permission -
 * there is no revocation flag to forget to check and no cron to run.
 */
export async function issueGrant(ctx, {
  vaultId, owner, verifier, verifierName, questionSet,
  usesAllowed = 3, minutes = null, days = 7, threshold = "", note = "", labelId = 0n, ownerSig = new Uint8Array(),
}) {
  const set = QUESTION_SETS[questionSet];
  if (!set) throw safeError(`unknown question set "${questionSet}"`);

  const grantId = `g-${crypto.randomUUID().slice(0, 8)}`;
  const expiration = minutes ? expiry.minutes(minutes) : expiry.days(days);
  const lifeMs = minutes ? minutes * 60_000 : days * 86_400_000;

  const res = await guardedWrite(
    ctx,
    ({ gas }) =>
      ctx.wallet.createEntity(
        Grant,
        {
          grantId: str(grantId),
          vaultId: str(vaultId),
          owner: addr(owner),
          verifier: addr(verifier),
          verifierName: str(fitStr(verifierName)),
          questionSet: str(questionSet),
          state: str("live"),
          usesAllowed: u64(BigInt(usesAllowed)),
          usesSpent: u64(0n),
          issuedAt: u64(now()),
          diesAt: u64(now() + BigInt(lifeMs)),
          roleBit: u256(set.roleBit),
          labelId: u256(BigInt(labelId)),
          threshold: str(fitStr(threshold)),
          note: str(fitStr(note)),
          ownerSig: bytes(ownerSig),
        },
        { expiration },
        { gas },
      ),
    { label: "issueGrant" },
  );
  return { grantId, entityKey: res.entityKey, txHash: res.txHash, tx: txLink(res.txHash), expiresAt: res.expiresAt?.toString(), roleBit: set.roleBit.toString() };
}

/** Burn one use. `state` flips to `spent` on the last use because the network
 *  cannot express "uses remaining is not zero" - there is no NOT. */
export async function spendGrant(ctx, entityKey, { usesSpent, usesAllowed }) {
  const next = BigInt(usesSpent) + 1n;
  const set = { usesSpent: u64(next) };
  if (next >= BigInt(usesAllowed)) set.state = str("spent");
  await guardedWrite(ctx, ({ gas }) => ctx.wallet.patchEntity(Grant, entityKey, { set }, { gas }), {
    label: "spendGrant",
  });
  return { usesSpent: next.toString(), state: set.state ?? "live" };
}

/**
 * Buy a permission more life.
 *
 * This is the one operation in AskOnly that is deliberately loud. It emits
 * ExpiryExtended on-chain, so a verifier (or an operator) who quietly keeps a
 * permission alive leaves a signed, public, timestamped trace - while letting it
 * die leaves nothing at all. Retention is the act that must be explained.
 *
 * `extendEntity` takes an OBJECT, not positional arguments.
 */
export async function extendGrant(ctx, entityKey, { days = null, minutes = null } = {}) {
  const expiration = minutes ? expiry.minutes(minutes) : expiry.days(days ?? 7);
  const res = await guardedWrite(
    ctx,
    ({ gas }) => ctx.wallet.extendEntity({ entityKey, expiration }, { gas }),
    { label: "extendGrant" },
  );

  // `extendEntity` moves $expiresAt, which is the only expiry that matters to the
  // network - but it does NOT touch our `diesAt` millisecond mirror, which is what
  // the countdown in the UI reads. Left alone, an extended permission renders as
  // "expired" while the network still happily returns it. Keep the mirror honest.
  const lifeMs = minutes ? minutes * 60_000 : (days ?? 7) * 86_400_000;
  try {
    await guardedWrite(
      ctx,
      ({ gas }) =>
        ctx.wallet.patchEntity(Grant, entityKey, { set: { diesAt: u64(now() + BigInt(lifeMs)) } }, { gas }),
      { label: "extendGrant:mirror" },
    );
  } catch (e) {
    // The extension itself succeeded, so report rather than fail the whole call.
    return {
      txHash: res.txHash, tx: txLink(res.txHash), expiresAt: res.expiresAt?.toString(),
      mirrorWarning: scrub(e),
    };
  }
  return { txHash: res.txHash, tx: txLink(res.txHash), expiresAt: res.expiresAt?.toString() };
}

export async function revokeGrant(ctx, entityKey) {
  await guardedWrite(
    ctx,
    ({ gas }) => ctx.wallet.patchEntity(Grant, entityKey, { set: { state: str("revoked") } }, { gas }),
    { label: "revokeGrant" },
  );
  return { state: "revoked" };
}

/** The receipt. `askerSig` is the verifier's own EIP-712 signature - without it
 *  the answer is never released to their screen. */
export async function recordAccess(ctx, a) {
  const accessId = `a-${crypto.randomUUID().slice(0, 8)}`;
  const res = await guardedWrite(
    ctx,
    ({ gas }) =>
      ctx.wallet.createEntity(
        Access,
        {
          accessId: str(accessId),
          grantId: str(a.grantId),
          vaultId: str(a.vaultId),
          owner: addr(a.owner),
          asker: addr(a.asker),
          askerName: str(fitStr(a.askerName ?? "")),
          questionHash: str(fitStr(a.questionHash)),
          answer: str(fitStr(a.answer)),
          answerHash: str(fitStr(a.answerHash)),
          requestId: str(fitStr(a.requestId ?? "")),
          provider: addr(a.provider),
          model: str(fitStr(a.model)),
          trustMode: str(fitStr(a.trustMode ?? "private")),
          verification: str(fitStr(a.verification ?? "request-id-only")),
          at: u64(now()),
          question: str(fitStr(a.question)),
          band: str(fitStr(a.band ?? "")),
          teeType: str(fitStr(a.teeType ?? "")),
          latencyMs: u64(BigInt(a.latencyMs ?? 0)),
          askerSig: bytes(a.askerSig ?? new Uint8Array()),
        },
        // The receipt outlives the capability on purpose: the permission must die,
        // the record of its use must not. Capped at MAX_LIFETIME either way.
        { expiration: expiry.days(a.keepDays ?? 180) },
        { gas },
      ),
    { label: "recordAccess" },
  );
  return { accessId, entityKey: res.entityKey, txHash: res.txHash, tx: txLink(res.txHash) };
}

export async function recordRefusal(ctx, r) {
  const refusalId = `r-${crypto.randomUUID().slice(0, 8)}`;
  const res = await guardedWrite(
    ctx,
    ({ gas }) =>
      ctx.wallet.createEntity(
        Refusal,
        {
          refusalId: str(refusalId),
          grantId: str(fitStr(r.grantId ?? "none")),
          owner: addr(r.owner),
          asker: addr(r.asker),
          questionHash: str(fitStr(r.questionHash)),
          reason: str(fitStr(r.reason)),
          at: u64(now()),
          question: str(fitStr(r.question)),
          detail: str(fitStr(r.detail ?? "")),
        },
        { expiration: expiry.days(r.keepDays ?? 180) },
        { gas },
      ),
    { label: "recordRefusal" },
  );
  return { refusalId, entityKey: res.entityKey, txHash: res.txHash, tx: txLink(res.txHash) };
}

/* ------------------------------------------------------------------ requests
   The verifier cannot answer - only ask. A request lands in the owner's inbox
   as `pending` and waits for the owner's device, which is the only thing that
   holds the passphrase.
   -------------------------------------------------------------------------- */

export async function openRequest(ctx, r) {
  const requestId = `q-${crypto.randomUUID().slice(0, 8)}`;
  const res = await guardedWrite(
    ctx,
    ({ gas }) =>
      ctx.wallet.createEntity(
        Request,
        {
          requestId: str(requestId),
          grantId: str(r.grantId),
          vaultId: str(r.vaultId),
          owner: addr(r.owner),
          asker: addr(r.asker),
          askerName: str(fitStr(r.askerName ?? "")),
          questionSet: str(r.questionSet),
          questionHash: str(fitStr(r.questionHash)),
          state: str("pending"),
          askedAt: u64(now()),
          decidedAt: u64(0n),
          accessId: str(""),
          question: str(fitStr(r.question)),
          askerSig: bytes(r.askerSig ?? new Uint8Array()),
        },
        // A request must not outlive the permission it is made under.
        { expiration: r.minutes ? expiry.minutes(r.minutes) : expiry.days(r.days ?? 7) },
        { gas },
      ),
    { label: "openRequest" },
  );
  return { requestId, entityKey: res.entityKey, txHash: res.txHash, tx: txLink(res.txHash) };
}

export async function decideRequest(ctx, entityKey, { state, accessId = "" }) {
  await guardedWrite(
    ctx,
    ({ gas }) =>
      ctx.wallet.patchEntity(
        Request,
        entityKey,
        { set: { state: str(state), decidedAt: u64(now()), accessId: str(fitStr(accessId)) } },
        { gas },
      ),
    { label: "decideRequest" },
  );
  return { state };
}

/** The owner's inbox: what is waiting on them right now. */
export async function pendingFor(reader, owner, limit = 25) {
  const { entities } = await reader
    .select({
      $key: true, requestId: true, grantId: true, vaultId: true, asker: true, askerName: true,
      questionSet: true, question: true, questionHash: true, askedAt: true, state: true,
    })
    .from(Request)
    .where(and(eq("owner", addr(owner)), eq("state", str("pending"))))
    .orderBy(desc("askedAt"))
    .limit(Math.min(limit, PAGE))
    .fetch();
  return entities.map((e) => ({
    entityKey: e.$key,
    requestId: val(e, "requestId"),
    grantId: val(e, "grantId"),
    vaultId: val(e, "vaultId"),
    asker: val(e, "asker"),
    askerName: val(e, "askerName"),
    questionSet: val(e, "questionSet"),
    question: val(e, "question"),
    questionHash: val(e, "questionHash"),
    askedAt: Number(val(e, "askedAt")),
    state: val(e, "state"),
  }));
}

/** What the verifier is waiting on. Returns null once the request has expired,
 *  which is the same signal as everywhere else: gone means gone. */
export async function requestById(reader, requestId) {
  const { entities } = await reader
    .select({
      $key: true, requestId: true, grantId: true, vaultId: true, owner: true, asker: true,
      questionSet: true, question: true, questionHash: true, state: true, askedAt: true,
      decidedAt: true, accessId: true,
    })
    .from(Request)
    .where(eq("requestId", str(requestId)))
    .limit(1)
    .fetch();
  const e = entities[0];
  if (!e) return null;
  return {
    entityKey: e.$key,
    requestId: val(e, "requestId"),
    grantId: val(e, "grantId"),
    vaultId: val(e, "vaultId"),
    owner: val(e, "owner"),
    asker: val(e, "asker"),
    questionSet: val(e, "questionSet"),
    question: val(e, "question"),
    questionHash: val(e, "questionHash"),
    state: val(e, "state"),
    askedAt: Number(val(e, "askedAt")),
    decidedAt: Number(val(e, "decidedAt")),
    accessId: val(e, "accessId"),
  };
}

/** One receipt, by id - what the verifier reads once the owner has answered. */
export async function accessById(reader, accessId) {
  const { entities } = await reader
    .select({
      $key: true, accessId: true, grantId: true, answer: true, band: true, question: true,
      questionHash: true, answerHash: true, requestId: true, provider: true, model: true,
      trustMode: true, verification: true, teeType: true, latencyMs: true, at: true,
    })
    .from(Access)
    .where(eq("accessId", str(accessId)))
    .limit(1)
    .fetch();
  const e = entities[0];
  if (!e) return null;
  return {
    entityKey: e.$key,
    accessId: val(e, "accessId"),
    grantId: val(e, "grantId"),
    answer: val(e, "answer"),
    band: val(e, "band"),
    question: val(e, "question"),
    questionHash: val(e, "questionHash"),
    answerHash: val(e, "answerHash"),
    requestId: val(e, "requestId"),
    provider: val(e, "provider"),
    model: val(e, "model"),
    trustMode: val(e, "trustMode"),
    verification: val(e, "verification"),
    teeType: val(e, "teeType"),
    latencyMs: Number(val(e, "latencyMs")),
    at: Number(val(e, "at")),
  };
}

/* ============================================================ READS ===== */

const val = (row, k) => row?.[k]?.value;

/**
 * Fetch a grant by id. Returns null when the grant has passed its death block,
 * because the network stops returning it - that null IS the expiry.
 */
export async function liveGrant(reader, grantId) {
  const { entities } = await reader
    .select({
      $key: true, $expiresAt: true, $owner: true,
      grantId: true, vaultId: true, owner: true, verifier: true, verifierName: true,
      questionSet: true, state: true, usesAllowed: true, usesSpent: true,
      issuedAt: true, diesAt: true, roleBit: true, labelId: true, threshold: true, note: true,
    })
    .from(Grant)
    .where(eq("grantId", str(grantId)))
    .limit(1)
    .fetch();
  const e = entities[0];
  if (!e) return null;
  return {
    entityKey: e.$key,
    expiresAtBlock: e.$expiresAt?.toString() ?? null,
    grantId: val(e, "grantId"),
    vaultId: val(e, "vaultId"),
    owner: val(e, "owner"),
    verifier: val(e, "verifier"),
    verifierName: val(e, "verifierName"),
    questionSet: val(e, "questionSet"),
    state: val(e, "state"),
    usesAllowed: Number(val(e, "usesAllowed")),
    usesSpent: Number(val(e, "usesSpent")),
    issuedAt: Number(val(e, "issuedAt")),
    diesAt: Number(val(e, "diesAt")),
    roleBit: BigInt(val(e, "roleBit")).toString(),
    labelId: BigInt(val(e, "labelId")).toString(),
    threshold: val(e, "threshold"),
    note: val(e, "note"),
  };
}

export async function grantsOf(reader, owner, limit = 50) {
  const { entities } = await reader
    .select({
      $key: true, $expiresAt: true,
      grantId: true, vaultId: true, verifierName: true, verifier: true, questionSet: true,
      state: true, usesAllowed: true, usesSpent: true, diesAt: true, issuedAt: true, threshold: true,
    })
    .from(Grant)
    .where(eq("owner", addr(owner)))
    .orderBy(desc("issuedAt"))
    .limit(Math.min(limit, PAGE))
    .fetch();
  return entities.map((e) => ({
    entityKey: e.$key,
    expiresAtBlock: e.$expiresAt?.toString() ?? null,
    grantId: val(e, "grantId"),
    vaultId: val(e, "vaultId"),
    verifier: val(e, "verifier"),
    verifierName: val(e, "verifierName"),
    questionSet: val(e, "questionSet"),
    state: val(e, "state"),
    usesAllowed: Number(val(e, "usesAllowed")),
    usesSpent: Number(val(e, "usesSpent")),
    diesAt: Number(val(e, "diesAt")),
    issuedAt: Number(val(e, "issuedAt")),
    threshold: val(e, "threshold"),
  }));
}

/** Grants still alive AND not yet used up. Two positive predicates, because
 *  "not spent" is inexpressible - the network has no NOT. */
export async function liveGrantsOf(reader, owner, limit = 50) {
  const { entities } = await reader
    .select({ $key: true, $expiresAt: true, grantId: true, verifierName: true, questionSet: true, diesAt: true })
    .from(Grant)
    .where(and(eq("owner", addr(owner)), eq("state", str("live"))))
    .orderBy(asc("diesAt"))
    .limit(Math.min(limit, PAGE))
    .fetch();
  return entities.map((e) => ({
    entityKey: e.$key,
    expiresAtBlock: e.$expiresAt?.toString() ?? null,
    grantId: val(e, "grantId"),
    verifierName: val(e, "verifierName"),
    questionSet: val(e, "questionSet"),
    diesAt: Number(val(e, "diesAt")),
  }));
}

export async function vaultsOf(reader, owner, limit = 50) {
  const { entities } = await reader
    .select({ $key: true, $expiresAt: true, vaultId: true, label: true, docKind: true, bytesLen: true, sha256: true, createdAt: true, state: true })
    .from(Vault)
    .where(and(eq("owner", addr(owner)), eq("state", str("live"))))
    .orderBy(desc("createdAt"))
    .limit(Math.min(limit, PAGE))
    .fetch();
  return entities.map((e) => ({
    entityKey: e.$key,
    expiresAtBlock: e.$expiresAt?.toString() ?? null,
    vaultId: val(e, "vaultId"),
    label: val(e, "label"),
    docKind: val(e, "docKind"),
    bytesLen: Number(val(e, "bytesLen")),
    sha256: val(e, "sha256"),
    createdAt: Number(val(e, "createdAt")),
  }));
}

/** The ciphertext, handed to the owner's browser to decrypt locally.
 *  `bytes` columns come back as hex and are never indexable or filterable. */
export async function vaultCipher(reader, vaultId) {
  const { entities } = await reader
    .select({ $key: true, vaultId: true, iv: true, cipher: true, sha256: true, label: true, docKind: true })
    .from(Vault)
    .where(eq("vaultId", str(vaultId)))
    .limit(1)
    .fetch();
  const e = entities[0];
  if (!e) return null;
  const raw = val(e, "cipher");
  return {
    entityKey: e.$key,
    vaultId: val(e, "vaultId"),
    iv: val(e, "iv"),
    sha256: val(e, "sha256"),
    label: val(e, "label"),
    docKind: val(e, "docKind"),
    cipher: raw ? hexToBytes(raw) : new Uint8Array(),
  };
}

/** "Who asked about me." The question the whole product exists to answer. */
export async function accessesOf(reader, owner, limit = 100) {
  const { entities } = await reader
    .select({
      $key: true, accessId: true, grantId: true, asker: true, askerName: true,
      question: true, questionHash: true, answer: true, band: true, answerHash: true,
      requestId: true, provider: true, model: true, trustMode: true, verification: true,
      teeType: true, latencyMs: true, at: true,
    })
    .from(Access)
    .where(eq("owner", addr(owner)))
    .orderBy(desc("at"))
    .limit(Math.min(limit, PAGE))
    .fetch();
  return entities.map((e) => ({
    entityKey: e.$key,
    accessId: val(e, "accessId"),
    grantId: val(e, "grantId"),
    asker: val(e, "asker"),
    askerName: val(e, "askerName"),
    question: val(e, "question"),
    questionHash: val(e, "questionHash"),
    answer: val(e, "answer"),
    band: val(e, "band"),
    answerHash: val(e, "answerHash"),
    requestId: val(e, "requestId"),
    provider: val(e, "provider"),
    model: val(e, "model"),
    trustMode: val(e, "trustMode"),
    verification: val(e, "verification"),
    teeType: val(e, "teeType"),
    latencyMs: Number(val(e, "latencyMs")),
    at: Number(val(e, "at")),
  }));
}

export async function refusalsOf(reader, owner, limit = 50) {
  const { entities } = await reader
    .select({ $key: true, refusalId: true, grantId: true, asker: true, question: true, reason: true, detail: true, at: true })
    .from(Refusal)
    .where(eq("owner", addr(owner)))
    .orderBy(desc("at"))
    .limit(Math.min(limit, PAGE))
    .fetch();
  return entities.map((e) => ({
    entityKey: e.$key,
    refusalId: val(e, "refusalId"),
    grantId: val(e, "grantId"),
    asker: val(e, "asker"),
    question: val(e, "question"),
    reason: val(e, "reason"),
    detail: val(e, "detail"),
    at: Number(val(e, "at")),
  }));
}

export async function countLiveGrants(reader) {
  return reader.count().from(Grant).where(eq("state", str("live"))).fetch();
}

export { scrub };
