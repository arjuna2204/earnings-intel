"use client";

import { useState } from "react";
import { useMode } from "@/components/ModeToggle";

/** The table behind a chart: folded away in Simple mode ("Show the numbers"), open in Pro. */
export default function ShowNumbers({ children, label = "Show the numbers" }: { children: React.ReactNode; label?: string }) {
  const pro = useMode() === "pro";
  const [open, setOpen] = useState(false);
  if (pro || open) return <>{children}</>;
  return (
    <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-muted hover:text-foreground">
      {label} ▾
    </button>
  );
}
