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

/** First port from `start` that nothing is listening on. */
function freePort(start, tries = 20) {
  return new Promise((resolve, reject) => {
    let port = start;
    const attempt = () => {
      if (port >= start + tries) return reject(new Error(`no free port near ${start}`));
      const s = createServer();
      s.once("error", () => {
        port += 1;
        attempt();
      });
      s.once("listening", () => s.close(() => resolve(port)));
      s.listen(port, "127.0.0.1");
    };
    attempt();
  });
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

console.log("\n  AskOnly\n  api  http://localhost:5174\n  app  http://localhost:5173   <- open this one\n");

run("api", process.execPath, ["--env-file=.env", "app/server.mjs"]);
run("web", npm, ["--prefix", "web", "run", "dev"], { shell: isWin });
