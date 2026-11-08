import ExcelJS from "exceljs";
import { t } from "@khidi/i18n";
import { formatTbilisiDateTime } from "@khidi/shared";
import type { MovementReport,ReportLine } from "./movements.ts";
export function decimalMinor(value:string|null) {
 if(value===null)return t("reports.unknown");
 const n=BigInt(value),a=n<0n?-n:n;return (n<0n?"-":"")+a/100n+"."+String(a%100n).padStart(2,"0");
}
const columns=["rowKind","kind","date","saleDate","exitDate","storefront","orderRef","sku","quantity","unitPrice","totalMinor","currency","vat","accountingId","accountingName","provenance","document","reason","relationship","componentSnapshots"] as const;
const values={ITEM:"reports.item",BUNDLE:"reports.bundle",COMPONENT:"reports.component",MOVEMENT:"reports.movement",COMMIT:"reports.commit",
 COMMIT_RELEASE:"reports.commit_release",HANDOVER_OUT:"reports.handover",BUNDLE_CANCELLED:"reports.bundle_cancelled",
 TRANSFER_OUT:"reports.transfer_out",TRANSFER_IN:"reports.transfer_in",STOCK_IN:"reports.stock_in",STOCK_OUT:"reports.stock_out",
 ADJUSTMENT:"reports.adjustment",WRITE_OFF:"reports.write_off",AUTO_ASSUMED:"fulfillment.AUTO_ASSUMED",SCAN:"fulfillment.SCAN",MANUAL:"fulfillment.MANUAL",
 PURCHASE:"reports.purchase",CONSIGNMENT:"reports.consignment"} as const;
export function reportValue(value:string) {
 return value.split(",").map(v=>v in values?t(values[v as keyof typeof values])+" ("+v+")":v).join(", ");
}
export function lineCells(l:ReportLine):string[] {
 return columns.map(k=>{
  const v=l[k];
  if(k==="componentSnapshots")return (l.componentSnapshots??[]).map(s=>[s.sku,s.accountingId??t("reports.unknown"),s.accountingName??t("reports.unknown")].join(" · ")).join(" | ");
  if(["rowKind","kind","provenance","relationship"].includes(k))return v?reportValue(String(v)):"";
  if(k==="unitPrice"||k==="totalMinor")return l.rowKind==="COMPONENT"?"":l.allocationUndetermined&&k==="totalMinor"?t("reports.unallocated"):decimalMinor(v as string|null);
  if(k==="date"||k==="saleDate"||k==="exitDate")return v?formatTbilisiDateTime(String(v)):"";
  if(k==="vat")return v===null?t("reports.unknown"):t(v?"reports.yes":"reports.no");
  return v==null?"":String(v);
 });
}
export function reportSheets(report:MovementReport) {
 const sections=(["seller","owner","transfers","other",...(report.range.availability?["availability" as const]:[])] as const).map(key=>({
  name:t(`reports.${key}`),headers:columns.map(k=>t(`reports.col.${k}`)),rows:report[key].map(lineCells)
 }));
 return [...sections,{name:t("reports.totals"),headers:[t("reports.view"),t("reports.col.storefront"),t("reports.col.currency"),t("reports.col.totalMinor")],
  rows:report.totals.map(r=>[t(`reports.${r.view}`),r.storefront??"",r.currency,decimalMinor(r.totalMinor)])}];
}
function csvCell(v:string) {
 // Formula injection protection also covers leading whitespace/control characters.
 const safe=/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?"'"+v:v;
 return '"'+safe.replaceAll('"','""')+'"';
}
export async function exportReport(report:MovementReport,format:"CSV"|"XLSX"):Promise<Buffer> {
 const sheets=reportSheets(report);
 if(format==="CSV")return Buffer.from("\uFEFF"+sheets.flatMap(s=>[[s.name],s.headers,...s.rows,[]]).map(row=>row.map(csvCell).join(",")).join("\r\n"),"utf8");
 const book=new ExcelJS.Workbook();book.creator="Khidi";book.created=new Date(report.range.to+"T20:00:00Z");
 for(const s of sheets) {
  const sheet=book.addWorksheet(s.name.slice(0,31));sheet.addRow(s.headers);sheet.addRows(s.rows);
  sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];
  sheet.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,s.rows.length+1),column:s.headers.length}};
  sheet.columns.forEach(c=>{c.width=24;});
 }
 return Buffer.from(await book.xlsx.writeBuffer());
}
