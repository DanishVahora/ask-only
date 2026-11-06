/**
 * AskOnly — does the thing actually start?
 *
 *   npm run smoke
 *
 * This exists because of a specific mistake. After rewriting the question
 * engine I checked that the library modules still imported — questions,
 * enclave, typed, ledger — and reported it green. I never imported the SERVER,
 * which still referenced two functions that no longer existed. `npm start`
 * died on a SyntaxError and the first person to find out was the person
 * trying to use it.
 *
 * So this boots the real server on a spare port and asks it questions, rather
 * than reasoning about whether it would work.
 */

import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 5390 + Math.floor(Math.random() * 60);

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`  FAIL  ${m}`);
};

/* ---------------------------------------------------- 1. every module ---- */
console.log("\n[1/3] every module imports");
const MODULES = [
  "../src/arkiv/schema.mjs",
  "../src/arkiv/client.mjs",
  "../src/arkiv/ledger.mjs",
  "../src/arkiv/watch.mjs",
  "../src/chain/gate.mjs",
  "../src/ask/questions.mjs",
  "../src/ask/enclave.mjs",
  "../src/auth/typed.mjs",
];
for (const m of MODULES) {
  try {
    await import(m);
    ok(m.replace("../", ""));
  } catch (e) {
    bad(`${m.replace("../", "")} — ${String(e.message).split("\n")[0].slice(0, 110)}`);
  }
}

/* ------------------------------------------------- 2. the server boots --- */
console.log("\n[2/3] the server actually starts");
const child = spawn(process.execPath, ["--env-file=.env", "app/server.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));

const up = await new Promise((resolve) => {
  const started = Date.now();
  const poll = setInterval(async () => {
    if (child.exitCode !== null) {
      clearInterval(poll);
      return resolve(false);
    }
    if (Date.now() - started > 25_000) {
      clearInterval(poll);
      return resolve(false);
    }
    try {
      const r = await fetch(`http://localhost:${PORT}/api/mode`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) {
        clearInterval(poll);
        resolve(true);
      }
    } catch {
      /* not up yet */
    }
  }, 500);
});

if (!up) {
  bad("the server did not start");
  console.log(
    output
      .split("\n")
      .filter(Boolean)
      .slice(0, 8)
      .map((l) => `        ${l}`)
      .join("\n"),
  );
} else {
  ok(`listening on ${PORT}`);

  /* ---------------------------------------------- 3. the routes answer --- */
  console.log("\n[3/3] the routes answer");
  const get = async (p) => {
    const r = await fetch(`http://localhost:${PORT}${p}`, { signal: AbortSignal.timeout(30_000) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  try {
    const mode = await get("/api/mode");
    mode.body.mode ? ok(`/api/mode — ${mode.body.mode}`) : bad("/api/mode returned nothing useful");

    const spec = await get("/api/spec");
    if ("chainId" in (spec.body.domain ?? {})) {
      bad("/api/spec pins a chainId — wallets on another network cannot sign");
    } else {
      ok("/api/spec — signing domain is chain-agnostic");
    }

    const health = await get("/api/health");
    const topics = Object.keys(health.body.questionSets ?? {});
    topics.length
      ? ok(`/api/health — topics: ${topics.join(", ")}`)
      : bad("/api/health exposes no topics");
    // The issue form reads these; a missing field rendered a control labelled "Value".
    const first = Object.values(health.body.questionSets ?? {})[0] ?? {};
    first.label && first.blurb
      ? ok("/api/health — topics carry label and blurb")
      : bad("/api/health topics are missing label/blurb");

    // It was a POST endpoint, so probe it as one.
    const gone = await fetch(`http://localhost:${PORT}/api/ask/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plaintext: "Gross: 68,000", question: "do they earn enough?" }),
      signal: AbortSignal.timeout(10_000),
    });
    gone.status === 404
      ? ok("/api/ask/prepare is gone — the server never receives plaintext")
      : bad(`/api/ask/prepare still answers (${gone.status}) — it took the decrypted document`);

    const grant = await get("/api/grant?id=definitely-not-real");
    grant.status === 404
      ? ok("a missing permission is a clean 404")
      : bad(`/api/grant returned ${grant.status} for a nonexistent id`);
  } catch (e) {
    bad(`a route threw: ${String(e.message).slice(0, 100)}`);
  }
}

child.kill();

console.log();
if (failures) {
  console.log(`SMOKE FAILED — ${failures} problem(s). Do not hand this to anyone yet.\n`);
  process.exit(1);
}
console.log("SMOKE GREEN — it imports, it boots, and it answers.\n");
