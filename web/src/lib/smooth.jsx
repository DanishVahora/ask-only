import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

let lenis = null;

/**
 * Smooth, weighted scrolling on every page, by Lenis.
 *
 * Lenis drives the page's scroll itself, so three things have to be squared with it.
 * A Sheet locks the page by hiding the body's overflow, so this watches for exactly
 * that and stops Lenis with it. The inside of any dialog is left to scroll natively,
 * or a stopped Lenis would swallow those wheel events too. And a new page starts at
 * the top, though not on first load, so a link to /#questions still lands there.
 *
 * Off entirely for anyone who has asked their system for less motion.
 */
export default function SmoothScroll() {
  const { pathname } = useLocation();
  const last = useRef(pathname);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const smooth = new Lenis({
      autoRaf: true,
      anchors: true,
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      prevent: (node) => node.getAttribute("role") === "dialog",
    });
    lenis = smooth;
    const sync = () => (document.body.style.overflow === "hidden" ? smooth.stop() : smooth.start());
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => {
      watch.disconnect();
      smooth.destroy();
      if (lenis === smooth) lenis = null;
    };
  }, []);

  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
