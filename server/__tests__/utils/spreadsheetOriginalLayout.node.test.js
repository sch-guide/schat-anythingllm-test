const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ExcelJS=require('exceljs');const {previewStyledSpreadsheet}=require('../../utils/originalSpreadsheet');
test('원본 XLSX 병합·너비·높이·정렬·색·테두리·글꼴 보존',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'schat-layout-'));try{
 const file=path.join(root,'sample.xlsx'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('원본');
 sheet.getColumn(1).width=21;sheet.getColumn(2).width=12;sheet.getRow(1).height=30;
 sheet.mergeCells('A1:A2');sheet.getCell('A1').value='가상부';sheet.getCell('A1').font={name:'Arial',size:14,bold:true};sheet.getCell('A1').alignment={horizontal:'center',vertical:'middle',wrapText:true};sheet.getCell('A1').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFCC00'}};sheet.getCell('A1').border={bottom:{style:'thin',color:{argb:'FF123456'}}};sheet.getCell('B2').value='0123';await book.xlsx.writeFile(file);
 const view=await previewStyledSpreadsheet(file);
 assert.equal(view.rows[0].height,40);assert.equal(view.columnWidths[0],152);assert.equal(view.merges.length,1);assert.equal(view.rows[0].styles[0].backgroundColor,'#FFCC00');assert.equal(view.rows[0].styles[0].fontWeight,'bold');assert.equal(view.rows[0].styles[0].textAlign,'center');assert.match(view.rows[0].styles[0].borderBottom,/123456/);assert.equal(view.rows[1].cells[1],'0123');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
