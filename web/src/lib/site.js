/**
 * Which copy of AskOnly this page is.
 *
 * askonly.vercel.app is the landing page alone, built with `vite build --mode static`
 * (web/vercel.json). Nothing answers /api there, and the app could not work there
 * anyway: 0G lets only a page on localhost:5173 call the enclave. So that copy points
 * at how to run AskOnly, instead of opening an app with nothing behind it.
 */
export const STATIC_SITE = import.meta.env.MODE === "static";

/** How to run the whole thing, on the machine that will answer. */
export const RUN_IT = "https://github.com/DanishVahora/ask-only#run-the-whole-thing";
