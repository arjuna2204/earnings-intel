"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export type ThemeColors = { dark: boolean; fg: string; muted: string; grid: string; up: string; down: string; card: string };

const DARK: ThemeColors = { dark: true, fg: "#eef1f0", muted: "#9aa3a0", grid: "rgba(255,255,255,0.07)", up: "#36d27f", down: "#ff6a3d", card: "#151718" };
const LIGHT: ThemeColors = { dark: false, fg: "#0b0c0d", muted: "#565b5a", grid: "rgba(11,12,13,0.08)", up: "#13894a", down: "#d4461a", card: "#e6eae8" };

/** Chart colors that follow the light/dark toggle. */
export function useThemeColors(): ThemeColors {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
  return dark ? DARK : LIGHT;
}
