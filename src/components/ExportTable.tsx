"use client";

import { useRef } from "react";

/** Cell text as a spreadsheet wants it: arrows become signs, no thousands separators inside numbers. */
function clean(t: string): string {
  let s = t.replace(/\s+/g, " ").trim();
  if (/^▼/.test(s)) s = "-" + s.replace(/^▼\s*/, "");
  s = s.replace(/^▲\s*/, "").replace(/↗|↕|▾|▴/g, "").trim();
  if (/^[−-]?\$?[\d,.]+[%×BMKT]?$/.test(s)) s = s.replace(/,/g, "").replace("−", "-");
  return s;
}

export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((r) => r.map((v) => (v == null ? "" : `"${String(v).replace(/"/g, '""')}"`)).join(","))
    .join("\r\n");
  // BOM so Excel opens UTF-8 correctly
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function DownloadButton({ onClick, label = "Download" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Download as a spreadsheet (opens in Excel, Numbers or Google Sheets)"
      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
    >
      ⤓ {label}
    </button>
  );
}

/** Wraps any table and adds a button that downloads it as a CSV spreadsheet. */
export default function ExportTable({ name, children }: { name: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const go = () => {
    const table = box.current?.querySelector("table");
    if (!table) return;
    const rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => clean((c as HTMLElement).innerText)));
    downloadCsv(name, rows);
  };
  return (
    <div ref={box}>
      <div className="mb-1 flex justify-end">
        <DownloadButton onClick={go} />
      </div>
      {children}
    </div>
  );
}
