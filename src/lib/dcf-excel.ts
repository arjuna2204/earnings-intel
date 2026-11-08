import ExcelJS from "exceljs";
import type { DcfModel } from "@/lib/dcf";

const M = 1e6;
const BLUE = { argb: "FF0000FF" };
const INPUT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const BOLD = { bold: true };
const PCT = "0.0%";
const USDM = '#,##0;(#,##0);"–"';
const USD = '"$"#,##0.00';

/** Build the DCF workbook (live formulas; yellow cells are inputs). */
export function buildDcfWorkbook(company: { name: string; ticker: string; cik: number }, dcf: DcfModel & { result: NonNullable<DcfModel["result"]> }): ExcelJS.Workbook {
  const a = dcf.assumptions;
  const hist = dcf.history;
  const last = hist[hist.length - 1];
  const fy0 = Number(last.fiscal_year);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Earnings Intel";
  wb.calcProperties.fullCalcOnLoad = true;

  // ---------------- Assumptions
  const as = wb.addWorksheet("Assumptions", { views: [{ state: "frozen", ySplit: 4 }] });
  as.columns = [{ width: 46 }, { width: 14 }, { width: 110 }];
  as.getCell("A1").value = `${company.name} (${company.ticker}) — DCF assumptions`;
  as.getCell("A1").font = { bold: true, size: 14 };
  as.getCell("A2").value = "Yellow cells are inputs — change them and the DCF, value per share and sensitivity table update. Dollar figures in millions except per-share.";
  as.getRow(4).values = ["Assumption", "Value", "Default source"];
  as.getRow(4).font = BOLD;
  const ref: Record<string, string> = {};
  const pctKeys = new Set(["tax_rate", "da_pct", "capex_pct", "nwc_pct", "risk_free", "erp", "cost_of_debt", "equity_weight", "terminal_growth"]);
  const order = [
    ...[1, 2, 3, 4, 5].map((t) => `growth_${t}`),
    ...[1, 2, 3, 4, 5].map((t) => `margin_${t}`),
    ...[1, 2, 3, 4, 5].map((t) => `capex_${t}`),
    "tax_rate", "da_pct", "capex_pct", "nwc_pct",
    "risk_free", "beta", "erp", "cost_of_debt", "equity_weight", "terminal_growth",
    "price", "shares", "net_debt",
  ];
  let r = 5;
  for (const k of order) {
    const x = a[k];
    if (!x) continue;
    const row = as.getRow(r);
    const isMoney = k === "net_debt" || k === "shares";
    row.getCell(1).value = x.label + (isMoney ? " (millions)" : "");
    const c = row.getCell(2);
    c.value = isMoney ? x.value / M : x.value;
    c.numFmt = k.startsWith("growth") || k.startsWith("margin") || k.startsWith("capex") || pctKeys.has(k) ? PCT : k === "price" ? USD : k === "beta" ? "0.00" : USDM;
    c.font = { color: BLUE };
    c.fill = INPUT_FILL;
    row.getCell(3).value = x.source;
    ref[k] = `Assumptions!$B$${r}`;
    r++;
  }
  r++;
  const ke = r;
  as.getCell(`A${ke}`).value = "Cost of equity (risk-free + beta × premium)";
  as.getCell(`B${ke}`).value = { formula: `${ref.risk_free}+${ref.beta}*${ref.erp}`, result: a.risk_free.value + a.beta.value * a.erp.value };
  as.getCell(`B${ke}`).numFmt = PCT;
  const wr = ke + 1;
  as.getCell(`A${wr}`).value = "WACC (discount rate)";
  as.getCell(`A${wr}`).font = BOLD;
  as.getCell(`B${wr}`).value = {
    formula: `${ref.equity_weight}*B${ke}+(1-${ref.equity_weight})*${ref.cost_of_debt}*(1-${ref.tax_rate})`,
    result: a.wacc.value,
  };
  as.getCell(`B${wr}`).numFmt = PCT;
  as.getCell(`B${wr}`).font = BOLD;
  as.getCell(`C${wr}`).value = a.wacc.source;
  ref.wacc = `Assumptions!$B$${wr}`;

  // ---------------- Historical (SEC)
  const hs = wb.addWorksheet("Historical (SEC)");
  const metrics: [string, string, "m" | "pct" | "sh"][] = [
    ["revenue", "Revenue", "m"],
    ["operating_income", "Operating income (EBIT)", "m"],
    ["pretax_income", "Pre-tax income", "m"],
    ["income_tax", "Income tax", "m"],
    ["da", "Depreciation & amortization", "m"],
    ["capex", "Capital expenditures", "m"],
    ["operating_cash_flow", "Operating cash flow", "m"],
    ["free_cash_flow", "Free cash flow", "m"],
    ["sbc", "Stock-based compensation", "m"],
    ["interest_expense", "Interest expense", "m"],
    ["cash", "Cash", "m"],
    ["total_debt", "Total debt", "m"],
    ["diluted_shares", "Diluted shares", "sh"],
  ];
  hs.columns = [{ width: 32 }, ...hist.map(() => ({ width: 13 }))];
  hs.getCell("A1").value = `${company.name} — fiscal-year figures from SEC filings (XBRL), USD millions`;
  hs.getCell("A1").font = { bold: true, size: 13 };
  hs.getRow(3).values = ["", ...hist.map((h) => `FY${h.fiscal_year}`)];
  hs.getRow(3).font = BOLD;
  metrics.forEach(([k, label], i) => {
    const row = hs.getRow(4 + i);
    row.getCell(1).value = label;
    hist.forEach((h, j) => {
      const v = h[k];
      const c = row.getCell(2 + j);
      c.value = typeof v === "number" ? v / M : null;
      c.numFmt = USDM;
    });
  });
  const mrow = 4 + metrics.length + 1;
  hs.getCell(`A${mrow}`).value = "Operating margin";
  hs.getCell(`A${mrow + 1}`).value = "Revenue growth";
  hist.forEach((_, j) => {
    const col = String.fromCharCode(66 + j);
    hs.getCell(`${col}${mrow}`).value = { formula: `IFERROR(${col}5/${col}4,"")` };
    hs.getCell(`${col}${mrow}`).numFmt = PCT;
    if (j > 0) {
      const prev = String.fromCharCode(65 + j);
      hs.getCell(`${col}${mrow + 1}`).value = { formula: `IFERROR(${col}4/${prev}4-1,"")` };
      hs.getCell(`${col}${mrow + 1}`).numFmt = PCT;
    }
  });
  hs.getCell(`A${mrow + 3}`).value = `Source: SEC EDGAR company facts for CIK ${company.cik} — https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}`;

  // ---------------- DCF
  const ds = wb.addWorksheet("DCF", { views: [{ state: "frozen", xSplit: 1 }] });
  ds.columns = [{ width: 40 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  ds.getCell("A1").value = `${company.name} (${company.ticker}) — discounted cash flow, USD millions`;
  ds.getCell("A1").font = { bold: true, size: 14 };
  ds.getRow(3).values = ["", `FY${fy0} actual`, ...[1, 2, 3, 4, 5].map((t) => `FY${fy0 + t}E`)];
  ds.getRow(3).font = BOLD;
  const cols = ["C", "D", "E", "F", "G"];
  const res = dcf.result;
  const L = (row: number, label: string, bold = false) => {
    ds.getCell(`A${row}`).value = label;
    if (bold) ds.getCell(`A${row}`).font = BOLD;
  };
  L(4, "Revenue growth");
  L(5, "Revenue", true);
  L(6, "Operating (EBIT) margin");
  L(7, "EBIT");
  L(8, "Tax rate");
  L(9, "NOPAT (EBIT × (1 − tax))");
  L(10, "+ Depreciation & amortization");
  L(11, "− Capital expenditures");
  L(12, "− Increase in working capital");
  L(13, "Free cash flow", true);
  L(14, "Discount factor");
  L(15, "Present value of free cash flow");
  ds.getCell("B5").value = Number(last.revenue) / M;
  ds.getCell("B5").numFmt = USDM;
  cols.forEach((c, i) => {
    const t = i + 1;
    const prev = i === 0 ? "B" : cols[i - 1];
    const row = res.rows[i];
    const set = (r_: number, formula: string, result: number, fmt: string) => {
      ds.getCell(`${c}${r_}`).value = { formula, result };
      ds.getCell(`${c}${r_}`).numFmt = fmt;
    };
    set(4, ref[`growth_${t}`], row.growth, PCT);
    set(5, `${prev}5*(1+${c}4)`, row.revenue / M, USDM);
    set(6, ref[`margin_${t}`], row.margin, PCT);
    set(7, `${c}5*${c}6`, row.ebit / M, USDM);
    set(8, ref.tax_rate, a.tax_rate.value, PCT);
    set(9, `${c}7*(1-${c}8)`, row.nopat / M, USDM);
    set(10, `${c}5*${ref.da_pct}`, row.da / M, USDM);
    set(11, `${c}5*${ref[`capex_${t}`] ?? ref.capex_pct}`, row.capex / M, USDM);
    set(12, `(${c}5-${prev}5)*${ref.nwc_pct}`, row.d_nwc / M, USDM);
    set(13, `${c}9+${c}10-${c}11-${c}12`, row.fcf / M, USDM);
    set(14, `1/(1+${ref.wacc})^${t}`, 1 / (1 + a.wacc.value) ** t, "0.000");
    set(15, `${c}13*${c}14`, row.pv / M, USDM);
  });
  ds.getRow(13).font = BOLD;
  const S = (row: number, label: string, formula: string, result: number | null, fmt: string, bold = false) => {
    L(row, label, bold);
    ds.getCell(`B${row}`).value = { formula, result: result ?? undefined };
    ds.getCell(`B${row}`).numFmt = fmt;
    if (bold) ds.getCell(`B${row}`).font = BOLD;
  };
  S(17, "Sum of PV of free cash flows", "SUM(C15:G15)", res.sum_pv / M, USDM);
  S(18, "Terminal value (Gordon growth)", `G13*(1+${ref.terminal_growth})/(${ref.wacc}-${ref.terminal_growth})`, res.terminal_value ? res.terminal_value / M : null, USDM);
  S(19, "PV of terminal value", "B18*G14", res.pv_terminal ? res.pv_terminal / M : null, USDM);
  S(20, "Enterprise value", "B17+B19", res.enterprise_value / M, USDM, true);
  S(21, "− Net debt", ref.net_debt, a.net_debt.value / M, USDM);
  S(22, "Equity value", "B20-B21", res.equity_value / M, USDM, true);
  S(23, "Diluted shares (millions)", ref.shares, a.shares.value / M, "#,##0.0");
  S(24, "Value per share", "B22/B23", res.per_share, USD, true);
  S(25, "Current share price", ref.price, a.price.value, USD);
  S(26, "Upside / (downside)", "B24/B25-1", res.upside, PCT, true);
  S(27, "Terminal value as % of enterprise value", "B19/B20", res.terminal_share, PCT);
  ds.getCell("B24").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2F0D9" } };
  ds.getCell("A29").value = "Free cash flow to the firm = EBIT × (1 − tax) + D&A − capex − increase in working capital. End-of-year discounting. Not investment advice.";
  ds.getCell("A29").font = { italic: true, color: { argb: "FF666666" } };

  // ---------------- Sensitivity
  const ss = wb.addWorksheet("Sensitivity");
  ss.columns = [{ width: 22 }, ...Array.from({ length: 5 }, () => ({ width: 13 }))];
  ss.getCell("A1").value = "Value per share: WACC (down) × terminal growth (across)";
  ss.getCell("A1").font = { bold: true, size: 13 };
  ss.getCell("A2").value = "Centered on the current assumptions; edit the Assumptions sheet and this table recalculates.";
  const deltas = [-0.01, -0.005, 0, 0.005, 0.01];
  deltas.forEach((dg, j) => {
    const c = ss.getCell(4, 2 + j);
    c.value = { formula: `${ref.terminal_growth}+${dg}`, result: a.terminal_growth.value + dg };
    c.numFmt = PCT;
    c.font = BOLD;
  });
  deltas.forEach((dw, i) => {
    const rowN = 5 + i;
    const wc = ss.getCell(rowN, 1);
    wc.value = { formula: `${ref.wacc}+${dw}`, result: a.wacc.value + dw };
    wc.numFmt = PCT;
    wc.font = BOLD;
    deltas.forEach((_, j) => {
      const gcol = String.fromCharCode(66 + j);
      const w = `$A${rowN}`;
      const g = `${gcol}$4`;
      const cell = ss.getCell(rowN, 2 + j);
      cell.value = {
        formula: `IF(${w}>${g},(NPV(${w},DCF!$C$13:$G$13)+DCF!$G$13*(1+${g})/(${w}-${g})/(1+${w})^5-DCF!$B$21)/DCF!$B$23,"n/a")`,
        result: res.sensitivity.values[i]?.[j] ?? undefined,
      };
      cell.numFmt = USD;
      if (i === 2 && j === 2) cell.font = BOLD;
    });
  });

  return wb;
}
