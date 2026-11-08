import type { NextRequest } from "next/server";
import { getCompanyByTicker } from "@/lib/company";
import { getDcf } from "@/lib/dcf";
import { buildDcfWorkbook } from "@/lib/dcf-excel";

/** Download the company's DCF as an Excel model with live formulas. Yellow cells are inputs. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/dcf/[ticker]">) {
  const { ticker } = await ctx.params;
  const company = await getCompanyByTicker(ticker.toUpperCase());
  if (!company) return new Response("Company not loaded", { status: 404 });
  const dcf = await getDcf(company.cik);
  if (!dcf || dcf.status !== "ok" || !dcf.result) return new Response(dcf?.note ?? "No DCF for this company yet", { status: 404 });
  const wb = buildDcfWorkbook(company, { ...dcf, result: dcf.result });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${company.ticker}-DCF.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
