import ExcelJS from "exceljs";
import { expect,it } from "vitest";
it("writes and reads ExcelJS extended conditional formatting using the patched CommonJS UUID v4 call",async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Khidi");
 sheet.getCell("A1").value=3;
 sheet.addConditionalFormatting({ref:"A1",rules:[{type:"iconSet",iconSet:"3Triangles",cfvo:[{type:"percent",value:0},{type:"percent",value:33},{type:"percent",value:67}],priority:1}]});
 const bytes=await book.xlsx.writeBuffer(),read=new ExcelJS.Workbook();await read.xlsx.load(bytes);
 expect(read.worksheets[0]!.getCell("A1").value).toBe(3);
 const model=read.worksheets[0]!.model as unknown as {conditionalFormattings:unknown[]};
 expect(model.conditionalFormattings).toHaveLength(1);
});
