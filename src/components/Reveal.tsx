"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A landing-page section that rises 8px and fades in once as it enters the view. Visible by default: it only
 * starts hidden when the page armed the effect (JS on, motion allowed; see the layout's head script).
 */
export default function Reveal({ children, className = "", as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" } & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.dataset.shown) return;
    if (!document.documentElement.classList.contains("reveal-armed")) {
      el.dataset.shown = "1";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.shown = "1";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={`reveal ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
