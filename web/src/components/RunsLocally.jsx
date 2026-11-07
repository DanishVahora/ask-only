import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { RUN_IT } from "../lib/site.js";

/**
 * Every app page, on the hosted copy.
 *
 * askonly.vercel.app is the landing page and its live demo. The app needs a server that
 * is not there, and the owner's own browser at localhost:5173, the one origin 0G lets a
 * browser call. Showing the app here only let people sign things that went nowhere.
 */
export default function RunsLocally() {
  return (
    <div className="mx-auto max-w-[680px] px-4 py-16 sm:px-8">
      <section className="tile-forest p-8">
        <h1 className="text-[clamp(1.875rem,1.5rem+1.4vw,2.5rem)] leading-[1.08]">
          AskOnly runs <span className="italic">on your own machine.</span>
        </h1>
        <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-relaxed text-on-forest-2">
          This copy is the landing page. The app needs your browser at localhost:5173, the one place 0G
          lets a browser reach the enclave, so nothing here can seal a document or answer for you.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a className="btn btn-primary" href={RUN_IT} target="_blank" rel="noreferrer">
            Run it yourself <ArrowRight size={16} strokeWidth={2} />
          </a>
          <Link className="link-action text-on-forest-2" to="/">
            Or try the live demo
          </Link>
        </div>
      </section>
    </div>
  );
}
