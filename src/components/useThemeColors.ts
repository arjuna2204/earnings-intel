"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export type ThemeColors = { dark: boolean; fg: string; muted: string; grid: string; up: string; down: string; card: string };

const DARK: ThemeColors = { dark: true, fg: "#f5f7f8", muted: "#8e9599", grid: "rgba(255,255,255,0.08)", up: "#00c805", down: "#ff5000", card: "#111415" };
const LIGHT: ThemeColors = { dark: false, fg: "#0b0d0e", muted: "#6b7275", grid: "rgba(0,0,0,0.07)", up: "#00a805", down: "#e64500", card: "#f6f7f8" };

/** Chart colors that follow the light/dark toggle. */
export function useThemeColors(): ThemeColors {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
  return dark ? DARK : LIGHT;
}
