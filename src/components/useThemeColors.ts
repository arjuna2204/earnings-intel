"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

export type ThemeColors = { dark: boolean; fg: string; muted: string; grid: string; up: string; down: string; card: string };

// keep in step with the CSS tokens in globals.css (DESIGN.md › Color)
const DARK: ThemeColors = { dark: true, fg: "#f5f6f6", muted: "#9ca1a4", grid: "rgba(255,255,255,0.08)", up: "#2bd46b", down: "#ff6a3d", card: "#121314" };
const LIGHT: ThemeColors = { dark: false, fg: "#0b0c0d", muted: "#5f6467", grid: "rgba(11,12,13,0.07)", up: "#00a63e", down: "#e8590c", card: "#f4f5f5" };

/** Chart colors that follow the light/dark toggle. */
export function useThemeColors(): ThemeColors {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return dark ? DARK : LIGHT;
}
