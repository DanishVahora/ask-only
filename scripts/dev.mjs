/**
 * AskOnly — run both halves with one command.
 *
 *   npm start
 *
 * The API on 5174, and Vite on 5173 proxying /api to it.
 *
 * 5173 is not a preference. It is the only localhost origin 0G's CORS
 * allowlist accepts, and the owner's browser calls the enclave directly, so
 * the app has to be served from there or the whole local-first claim quietly
 * degrades into relaying through a server. Vite is told strictPort, so if
 * something else holds 5173 it fails loudly instead of sliding to 5174.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { existsSync } from "node:fs";

/** Can this exact address be bound right now? */
function canBind(port, host) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once("error", (e) => resolve(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT"));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

/**
 * First port from `start` that nothing is listening on.
 *
 * All three addresses, because a server holds only some of them: Vite binds
 * ::1, Node's default binds ::. Probing 127.0.0.1 alone reported both as free
 * while they were in use. A machine with no IPv6 counts as bindable there.
 */
async function freePort(start, tries = 20) {
  for (let port = start; port < start + tries; port += 1) {
    // One at a time: :: is dual-stack on some systems, so binding it alongside
    // 127.0.0.1 would make a free port collide with its own probe.
    let free = true;
    for (const host of ["127.0.0.1", "::1", "::"]) {
      free = free && (await canBind(port, host));
    }
    if (free) return port;
  }
  throw new Error(`no free port near ${start}`);
}

const ROOT = path.resolve(import.meta.dirname, "..");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

if (!existsSync(path.join(ROOT, "web", "node_modules"))) {
  console.error("\n  web/node_modules is missing. Run:  npm --prefix web install\n");
  process.exit(1);
}

const children = [];
function run(name, cmd, args, { shell = false, ...opts } = {}) {
  // Only npm needs a shell on Windows. Spawning node through one breaks on
  // the space in "C:\Program Files\nodejs\node.exe", because shell:true
  // concatenates the arguments instead of escaping them.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell,
    ...opts,
  });
  const tag = `[${name}]`.padEnd(7);
  const pipe = (stream, to) =>
    stream.on("data", (b) => {
      for (const line of String(b).split(/\r?\n/)) {
        if (line.trim()) to.write(`${tag} ${line}\n`);
      }
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stdout);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.log(`${tag} exited with ${code}`);
      shutdown(code);
    }
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

/* 5173 is the one port that may not move, so say what to do when it is held,
 * rather than letting Vite die with a line nobody reads. */
const appPort = await freePort(5173, 1).catch(() => null);
if (!appPort) {
  console.error(
    "\n  Port 5173 is already in use, probably by an earlier run that did not exit." +
      "\n  Free it with:  npx kill-port 5173\n  Then run npm start again.\n",
  );
  process.exit(1);
}

/* The API walks past anything already bound, and Vite is told where it landed.
 * freePort was written for this and never called, so a server left over from an
 * earlier run kept 5174 and the app went on talking to old code without saying
 * so. That cost an evening of "bugs" that were only stale code. */
const apiPort = await freePort(5174);
if (apiPort !== 5174) console.log(`  (5174 is held by an older process, so the API is on ${apiPort})`);

console.log(`\n  AskOnly\n  api  http://localhost:${apiPort}\n  app  http://localhost:5173   <- open this one\n`);

// --watch: change the server and it restarts itself. Stale code cannot be running.
run("api", process.execPath, ["--watch", "--env-file=.env", "app/server.mjs"], {
  env: { ...process.env, PORT: String(apiPort) },
});
run("web", npm, ["--prefix", "web", "run", "dev"], {
  shell: isWin,
  env: { ...process.env, ASKONLY_API_PORT: String(apiPort) },
});
