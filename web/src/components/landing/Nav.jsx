import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import Mark from "../Mark.jsx";
import AppLink from "./AppLink.jsx";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={clsx("lp-nav", scrolled && "is-scrolled")}>
      <div className="lp-nav-in">
        <Link to="/" className="lp-logo">
          <Mark size={22} />
          AskOnly
        </Link>
        <nav className="lp-nav-links" aria-label="On this page">
          <a href="#how">How it works</a>
          <a href="#small-print">The small print</a>
          <a href="#questions">Questions</a>
        </nav>
        <AppLink className="lp-btn lp-btn-sm" />
      </div>
    </header>
  );
}
