"use client";

import { useSyncExternalStore } from "react";

/** Simple / Pro: Simple hides trader-level detail (anything marked `pro-only`). Remembered per browser. */
export type Mode = "simple" | "pro";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
  return () => obs.disconnect();
}

export function useMode(): Mode {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.mode === "pro" ? "pro" : "simple"),
    () => "simple",
  );
}

export default function ModeToggle() {
  const mode = useMode();
  const set = (m: Mode) => {
    document.documentElement.setAttribute("data-mode", m);
    try {
      localStorage.setItem("mode", m);
    } catch {}
  };
  return (
    <div role="radiogroup" aria-label="Detail level" className="flex rounded-full border border-border p-0.5 text-xs font-semibold">
      {(["simple", "pro"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => set(m)}
          title={m === "simple" ? "The essentials, in plain English" : "Everything, including trader-level stats"}
          className={`rounded-full px-2.5 py-1 transition ${mode === m ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
        >
          <span className="hidden sm:inline">{m === "simple" ? "Essentials" : "Full detail"}</span>
          <span className="sm:hidden">{m === "simple" ? "Basic" : "Full"}</span>
        </button>
      ))}
    </div>
  );
}

/** Children only in Pro mode (for client components; server markup uses the `pro-only` class). */
export function ProOnly({ children }: { children: React.ReactNode }) {
  return useMode() === "pro" ? <>{children}</> : null;
}
