import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Port 5173 is NOT a default we happened to accept - it is a requirement.
 *
 * 0G's router allowlists browser origins by exact origin, port included.
 * Probed 2026-11-06: localhost:5173 gets Access-Control-Allow-Origin back;
 * 5174, 4319, 8080, 8000 and 4200 all get a flat 403. The owner's browser
 * calls the enclave directly, so if this does not run on 5173 that call dies
 * and the app silently falls back to relaying through a server - which is
 * exactly the trusted middleman the design exists to remove.
 *
 * The API server therefore moves to 5174 and we proxy to it, keeping the
 * browser's origin on 5173 where 0G will talk to it.
 */
// The API port is chosen by scripts/dev.mjs (it walks past anything already
// bound) and handed over in the environment, so a stale server left running on
// the default does not silently break the proxy.
const API_PORT = process.env.ASKONLY_API_PORT || "5174";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // 5173 or nothing - see the note above
    proxy: {
      "/api": { target: `http://localhost:${API_PORT}`, changeOrigin: false },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
