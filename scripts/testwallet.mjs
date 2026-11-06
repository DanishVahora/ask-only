/**
 * AskOnly — a real wallet for a headless browser.
 *
 *   node --env-file=.env scripts/testwallet.mjs
 *
 * Headless Chrome has no MetaMask, so the browser half of this product could
 * only ever be tested by a human clicking. That is not good enough for
 * something whose whole claim rests on who signed what.
 *
 * So: a tiny signer holding two throwaway keys, and an EIP-1193 provider that
 * the page can be given as `window.ethereum`. The browser then signs for real —
 * real EIP-712, real recoverable signatures, which the server verifies exactly
 * as it would verify MetaMask's. Switching "accounts" is a POST.
 *
 * These keys are generated fresh on every run and never touch the repo. This
 * is a test harness, not a wallet.
 */

import http from "node:http";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const PORT = Number(process.env.TESTWALLET_PORT || 5310);

/* Two people: the document owner, and the person asking about it. */
const ACCOUNTS = [
  { name: "Owner", account: privateKeyToAccount(generatePrivateKey()) },
  { name: "Landlord", account: privateKeyToAccount(generatePrivateKey()) },
];
let selected = 0;

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(s),
    // the page is on :5173 and this is on :5310
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(s);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/accounts") {
      return json(res, 200, {
        selected,
        accounts: ACCOUNTS.map((a, i) => ({ index: i, name: a.name, address: a.account.address })),
        current: ACCOUNTS[selected].account.address,
      });
    }

    if (url.pathname === "/select") {
      const i = Number(url.searchParams.get("i") ?? 0);
      if (!ACCOUNTS[i]) return json(res, 400, { error: "no such account" });
      selected = i;
      console.log(`  switched to ${ACCOUNTS[i].name} ${ACCOUNTS[i].account.address}`);
      return json(res, 200, { selected, current: ACCOUNTS[i].account.address });
    }

    if (url.pathname === "/sign" && req.method === "POST") {
      try {
        const { address, typedData } = await readBody(req);
        const entry =
          ACCOUNTS.find((a) => a.account.address.toLowerCase() === String(address).toLowerCase()) ??
          ACCOUNTS[selected];
        const { domain, types, primaryType, message } = typedData;

        // EIP-712 numbers arrive as JSON strings; viem wants bigints back.
        const coerced = { ...message };
        for (const f of types[primaryType] ?? []) {
          if (/^uint|^int/.test(f.type) && coerced[f.name] !== undefined) {
            coerced[f.name] = BigInt(coerced[f.name]);
          }
        }
        const signature = await entry.account.signTypedData({
          domain,
          types,
          primaryType,
          message: coerced,
        });
        console.log(`  signed ${primaryType} as ${entry.name}`);
        return json(res, 200, { signature, address: entry.account.address });
      } catch (e) {
        console.log(`  sign failed: ${e.message}`);
        return json(res, 400, { error: String(e.message).slice(0, 200) });
      }
    }

    json(res, 404, { error: "not found" });
  })
  .listen(PORT, () => {
    console.log(`\n  test wallet on http://localhost:${PORT}`);
    for (const [i, a] of ACCOUNTS.entries()) {
      console.log(`  [${i}] ${a.name.padEnd(9)} ${a.account.address}`);
    }
    console.log();
  });
