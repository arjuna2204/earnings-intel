"use client";

import { useState } from "react";

/** Copies text to the clipboard; shows a preview of what will be copied on hover. */
export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          window.prompt("Copy this:", text);
        }
      }}
      className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
