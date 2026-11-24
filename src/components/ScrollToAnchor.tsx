"use client";

import { useEffect } from "react";

/** Scrolls to a section once it has streamed in: old links (?view=events, ?view=options) land where that content moved. */
export default function ScrollToAnchor({ id }: { id: string }) {
  useEffect(() => {
    let tries = 0;
    let t = 0;
    const go = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      else if (tries++ < 40) t = window.setTimeout(go, 100);
    };
    go();
    return () => window.clearTimeout(t);
  }, [id]);
  return null;
}
