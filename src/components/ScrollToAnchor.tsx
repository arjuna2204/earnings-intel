"use client";

import { useEffect } from "react";

/**
 * Scrolls to a section once it has streamed in: old links (?view=events, ?view=options) land where that content
 * moved. Content above it (chart, cards) can still be streaming and push it down, so it re-aims while the section
 * keeps moving, and stops as soon as the visitor scrolls themselves.
 */
export default function ScrollToAnchor({ id }: { id: string }) {
  useEffect(() => {
    let stop = false;
    let timer = 0;
    const start = performance.now();
    let settledSince = 0;
    let lastTop = Number.NaN;
    const quit = () => {
      stop = true;
    };
    window.addEventListener("wheel", quit, { passive: true });
    window.addEventListener("touchstart", quit, { passive: true });
    window.addEventListener("keydown", quit);
    const offset = 150; // site header + sticky company bar + a little air
    const tick = () => {
      if (stop || performance.now() - start > 12000) return;
      const el = document.getElementById(id);
      if (el) {
        const top = el.getBoundingClientRect().top;
        if (Math.abs(top - offset) > 4) window.scrollBy({ top: top - offset });
        const now = el.getBoundingClientRect().top;
        if (Math.abs(now - lastTop) < 1) {
          if (!settledSince) settledSince = performance.now();
          if (performance.now() - settledSince > 1200) return; // stayed put: done
        } else settledSince = 0;
        lastTop = now;
      }
      timer = window.setTimeout(tick, 120);
    };
    tick();
    return () => {
      quit();
      window.clearTimeout(timer);
      window.removeEventListener("wheel", quit);
      window.removeEventListener("touchstart", quit);
      window.removeEventListener("keydown", quit);
    };
  }, [id]);
  return null;
}
