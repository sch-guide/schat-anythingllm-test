const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
const {resolveWorkspaceDocumentId}=require("./originalDocuments");
function spreadsheetRoot(){return process.env.NODE_ENV==="production" && process.env.STORAGE_DIR
 ? path.join(process.env.STORAGE_DIR,"original-spreadsheets") : path.resolve(__dirname,"../storage/original-spreadsheets");}
function resolveSpreadsheet({ref,documents=[],storageRoot=spreadsheetRoot(),refRoot}) {
 const match=resolveWorkspaceDocumentId({pdfRef:ref,documents,storageRoot:refRoot});
 if(!match || !/\.(xlsx|xls)$/iu.test(match.metadata.title||""))return null;
 const key=createHash("sha256").update(match.documentId).digest("hex");
 try{
  const metadata=JSON.parse(fs.readFileSync(path.join(storageRoot,key+".json"),"utf8"));
  if(![".xlsx",".xls"].includes(metadata.extension))return null;
  const filePath=path.join(storageRoot,key+metadata.extension);
  if(!fs.existsSync(filePath))return null;
  return {filePath,filename:path.basename(metadata.filename),documentId:match.documentId};
 }catch{return null;}
}
function previewSpreadsheet(filePath,{sheet,start=0,limit=100,parser}={}) {
 if(fs.statSync(filePath).size>20*1024*1024)throw Error("SPREADSHEET_TOO_LARGE");
 if(!parser)parser=require(require.resolve("xlsx",{paths:[path.resolve(__dirname,"../../collector"),"/app/collector"]}));
 const book=parser.readFile(filePath,{cellStyles:true,cellFormula:false,bookVBA:false});
 const name=sheet||book.SheetNames[0];
 if(!book.SheetNames.includes(name))throw Error("SHEET_NOT_FOUND");
 const ws=book.Sheets[name];
 const range=ws["!ref"] ? parser.utils.decode_range(ws["!ref"]) : null;
 // Ignore only trailing formatting-only cells; keep leading/interior blanks and
 // every non-empty merged area's extent. Search extraction is untouched.
 let lastRow=-1,lastColumn=-1;
 const hasValue=cell=>cell&&String(cell.w??cell.v??"").trim()!=="";
 for(const [address,cell] of Object.entries(ws)){
  const match=/^([A-Z]+)(\d+)$/u.exec(address);if(!match||!hasValue(cell))continue;
  let column=0;for(const letter of match[1])column=column*26+letter.charCodeAt(0)-64;
  lastColumn=Math.max(lastColumn,column-1);lastRow=Math.max(lastRow,Number(match[2])-1);
 }
 for(const merge of ws["!merges"]||[])if(hasValue(ws[parser.utils.encode_cell(merge.s)])){
  lastColumn=Math.max(lastColumn,merge.e.c);lastRow=Math.max(lastRow,merge.e.r);
 }
 const totalRows=range?Math.min(range.e.r+1,lastRow+1):0,totalColumns=range?Math.min(range.e.c+1,lastColumn+1):0;
 start=Math.min(Math.max(0,Math.trunc(Number(start)||0)),Math.max(0,totalRows-1));
 limit=Math.max(1,Math.min(200,Math.trunc(Number(limit)||100)));
 const columns=Math.min(80,totalColumns);
 const value=(r,c)=>{const cell=ws[parser.utils.encode_cell({r,c})];return cell ? String(cell.w??parser.utils.format_cell(cell)).slice(0,4000) : "";};
 const rows=[];
 for(let r=start;r<Math.min(start+limit,totalRows);r++)rows.push({row:r+1,cells:Array.from({length:columns},(_,c)=>value(r,c))});
 const merges=(ws["!merges"]||[]).filter(m=>m.e.r>=start&&m.s.r<start+limit&&m.s.c<columns).slice(0,10000)
  .map(m=>({s:m.s,e:m.e,value:value(m.s.r,m.s.c)}));
 return {columnWidths:Array.from({length:columns},(_,c)=>ws["!cols"]?.[c]?.wpx||90),themeColors:(book.Themes?.themeElements?.clrScheme||[]).map(color=>color.rgb),sheets:book.SheetNames,sheet:name,start,totalRows,totalColumns,columns,rows,merges,truncatedColumns:totalColumns>columns};
}
function publicOriginalSpreadsheetMetadata(metadata={}, {storageRoot=spreadsheetRoot(),refRoot}={}) {
 const id=String(metadata.document_id||"").trim();
 if(!id || !/\.(xlsx|xls)$/iu.test(metadata.title||""))return {};
 const key=createHash("sha256").update(id).digest("hex");
 try {
  const saved=JSON.parse(fs.readFileSync(path.join(storageRoot,key+".json"),"utf8"));
  if(![".xlsx",".xls"].includes(saved.extension) || !fs.existsSync(path.join(storageRoot,key+saved.extension)))return {};
  return {spreadsheetRef:require("./originalDocuments").pdfRefForDocumentId(id,{storageRoot:refRoot}),originalSpreadsheetAvailable:true};
 } catch {return {};}
}
async function previewStyledSpreadsheet(filePath,options={}) {
 const data=previewSpreadsheet(filePath,options);
 if(!/\.xlsx$/iu.test(filePath))return data;
 const ExcelJS=require("exceljs"),book=new ExcelJS.Workbook();
 await book.xlsx.readFile(filePath);
 const sheet=book.getWorksheet(data.sheet);
 const {originalCellStyle,columnWidthPixels}=require("./spreadsheetOriginalStyle");
 data.columnWidths=Array.from({length:data.columns},(_,c)=>columnWidthPixels(sheet.getColumn(c+1).width||sheet.properties.defaultColWidth||8.43));
 data.hiddenColumns=Array.from({length:data.columns},(_,c)=>!!sheet.getColumn(c+1).hidden);
 data.rows=data.rows.map(row=>({...row,height:(sheet.getRow(row.row).height||sheet.properties.defaultRowHeight||15)*4/3,hidden:!!sheet.getRow(row.row).hidden,
  styles:row.cells.map((_,c)=>originalCellStyle(sheet.getCell(row.row,c+1).style,data.themeColors))}));
 data.merges=data.merges.map(merge=>({...merge,style:originalCellStyle(sheet.getCell(merge.s.r+1,merge.s.c+1).style,data.themeColors)}));
 return data;
}
module.exports={spreadsheetRoot,resolveSpreadsheet,previewSpreadsheet,previewStyledSpreadsheet,publicOriginalSpreadsheetMetadata};
