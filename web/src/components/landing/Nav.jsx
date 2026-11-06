import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";

/** A sheet of paper with one corner gone. */
export function Mark({ size = 20 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        flex: "none",
        background: "currentColor",
        borderRadius: size * 0.2,
        clipPath: "polygon(0 0, 100% 0, 100% 58%, 58% 100%, 0 100%)",
      }}
    />
  );
}

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
          <Mark size={21} />
          AskOnly
        </Link>
        <nav className="lp-nav-links" aria-label="On this page">
          <a href="#how">How it works</a>
          <a href="#small-print">The small print</a>
          <a href="#questions">Questions</a>
        </nav>
        <Link to="/documents" className="lp-btn lp-btn-sm">
          Seal a document
        </Link>
      </div>
    </header>
  );
}
