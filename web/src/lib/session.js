import { useCallback } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// A namespace import on purpose. sessionMessage, SESSION_DAYS and TYPES.Session arrive
// with the server change, and a named import of something not exported yet would stop
// the whole app from loading.
import * as A from "./askonly.js";

/**
 * Sign in once, on this browser.
 *
 * The wallet signs one Session naming a key made here, and from then on this browser
 * signs for the wallet by itself: sealing, adding a reviewer, ending one, deleting a
 * document, asking a question. One wallet popup a week instead of one for everything.
 * The server checks both signatures before it writes, and the record keeps both, so
 * anyone can still check who did what.
 *
 * It switches on by itself once the server takes sessions (Session in /api/spec). Until
 * then every action is signed by the wallet, exactly as before.
 */
const MARGIN_S = 10 * 60; // nothing is started on a session about to run out
const nameFor = (address) => `askonly.session.${String(address).toLowerCase()}`;

export const specQuery = { queryKey: ["spec"], queryFn: () => A.api("/api/spec"), staleTime: 60_000 };

/** The session this wallet holds in this browser, if it has a while left to run. */
export function heldSession(address) {
  if (!address) return null;
  try {
    const s = JSON.parse(localStorage.getItem(nameFor(address)) ?? "null");
    if (!s || !(s.diesAt - MARGIN_S > Date.now() / 1000)) return null;
    const account = privateKeyToAccount(s.privateKey);
    return { account, session: { sessionKey: account.address, diesAt: s.diesAt, sig: s.sig } };
  } catch {
    return null;
  }
}

/** A session the server turned down is no use. The next action signs in afresh. */
export function forgetSession(address) {
  if (address) localStorage.removeItem(nameFor(address));
}

/** The server said the session itself was the problem: expired, or not one it accepts. */
export const sessionRefused = (e) => e?.status === 401 && /^session-/.test(String(e?.data?.code ?? ""));

/**
 * { on, signedIn, ensure, sign, signAndSend }
 *
 * sign({ types, primaryType, message }) resolves to { sig, session }: with sessions on,
 * sig is this browser's and session is what the server checks it against; with them
 * off, sig is the wallet's and session is undefined. Send both either way.
 */
export function useSessions() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: spec } = useQuery(specQuery);
  const on = Boolean(spec?.types?.Session && A.TYPES?.Session && A.sessionMessage);

  /** This wallet's session here, signing in first if there isn't one. The only popup. */
  const ensure = useCallback(async () => {
    const held = heldSession(address);
    if (held) return held;
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const diesAt = Math.floor(Date.now() / 1000) + (A.SESSION_DAYS ?? 7) * 86_400;
    const sig = await signTypedDataAsync({
      domain: A.DOMAIN,
      types: { Session: A.TYPES.Session },
      primaryType: "Session",
      message: A.sessionMessage({ sessionKey: account.address, diesAt }),
    });
    localStorage.setItem(nameFor(address), JSON.stringify({ privateKey, diesAt, sig }));
    return { account, session: { sessionKey: account.address, diesAt, sig } };
  }, [address, signTypedDataAsync]);

  const sign = useCallback(
    async ({ types, primaryType, message }) => {
      if (!address) throw new Error("Connect your wallet first");
      if (!on) return { sig: await signTypedDataAsync({ domain: A.DOMAIN, types, primaryType, message }) };
      const held = await ensure();
      const sig = await held.account.signTypedData({ domain: A.DOMAIN, types, primaryType, message });
      return { sig, session: held.session };
    },
    [address, on, ensure, signTypedDataAsync],
  );

  /** Sign and send. If the server turned the session down, sign in again and resend once. */
  const signAndSend = useCallback(
    async (what, send) => {
      const first = await sign(what);
      try {
        return await send(first);
      } catch (e) {
        if (!first.session || !sessionRefused(e)) throw e;
        forgetSession(address);
        return send(await sign(what));
      }
    },
    [address, sign],
  );

  return { on, signedIn: on && Boolean(heldSession(address)), ensure, sign, signAndSend };
}
