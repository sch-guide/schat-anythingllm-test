const test=require("node:test"), assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {persistSpreadsheet}=require("../../../collector/processSingleFile/convert/originalSpreadsheet");
const {resolveSpreadsheet,previewSpreadsheet,publicOriginalSpreadsheetMetadata}=require("../../utils/originalSpreadsheet");
test("원본 엑셀 보관·작업공간 소속 확인·표의 앞자리0·병합 보존",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"schat-sheet-"));
 try{
  const input=path.join(root,"test.xlsx");fs.writeFileSync(input,"fake workbook");
  persistSpreadsheet({sourcePath:input,documentId:"fake-id",filename:"가짜.xlsx",storageRoot:root});
  const {pdfRefForDocumentId}=require("../../utils/originalDocuments");
  const refRoot=path.join(root,"refs");const ref=pdfRefForDocumentId("fake-id",{storageRoot:refRoot});
  assert.deepEqual(publicOriginalSpreadsheetMetadata({document_id:"fake-id",title:"가짜.xlsx"},{storageRoot:root,refRoot}),{spreadsheetRef:ref,originalSpreadsheetAvailable:true});
  assert.deepEqual(publicOriginalSpreadsheetMetadata({document_id:"unknown",title:"가짜.xlsx"},{storageRoot:root,refRoot}),{});
  assert.deepEqual(publicOriginalSpreadsheetMetadata({document_id:"fake-id",title:"가짜.pdf"},{storageRoot:root,refRoot}),{});
  const docs=[{metadata:JSON.stringify({document_id:"fake-id",title:"가짜.xlsx"})}];
  assert.equal(resolveSpreadsheet({ref,documents:[],storageRoot:root,refRoot}),null);
  assert.equal(resolveSpreadsheet({ref:"../not-a-ref",documents:docs,storageRoot:root,refRoot}),null);
  const resolved=resolveSpreadsheet({ref,documents:docs,storageRoot:root,refRoot});
  assert.equal(fs.readFileSync(resolved.filePath,"utf8"),"fake workbook");
  assert.equal(resolved.filename,"가짜.xlsx");
  assert.throws(()=>persistSpreadsheet({sourcePath:input,documentId:"fake-id",filename:"가짜.xlsx",storageRoot:root}),/EEXIST/);
  const fake={SheetNames:["연락처"],Sheets:{"연락처":{"!ref":"A1:B3","!merges":[{s:{r:1,c:0},e:{r:2,c:0}}],A2:{v:"가나다"},B2:{v:123,w:"0123"},B3:{v:"5678"}}}};
  const parser={readFile:()=>fake,utils:{decode_range:()=>({s:{r:0,c:0},e:{r:2,c:1}}),encode_cell:({r,c})=>String.fromCharCode(65+c)+(r+1),format_cell:cell=>cell.w||String(cell.v)}};
  const preview=previewSpreadsheet(resolved.filePath,{parser});
  assert.equal(preview.rows[1].cells[1],"0123");
  assert.equal(preview.merges.length,1);
  assert.equal(preview.totalRows,3);
  assert.throws(()=>previewSpreadsheet(resolved.filePath,{parser,sheet:"없는시트"}),/SHEET_NOT_FOUND/);
 }finally{if(path.dirname(root)!==os.tmpdir())throw Error("UNSAFE_CLEANUP");fs.rmSync(root,{recursive:true,force:true});}
});

test('원본 보기만 후미 빈 서식 영역을 제외하고 실제 마지막 셀과 병합을 유지',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'schat-sheet-bounds-'));
 try{const file=path.join(root,'test.xlsx');fs.writeFileSync(file,'fake');
 const ws={'!ref':'A1:W999','!merges':[{s:{r:74,c:4},e:{r:89,c:4}}],A1:{v:'과명'},E75:{v:'업무 형태\n여러 줄'},E92:{v:'마지막 내용'},W999:{s:{}}};
 const parser={readFile:()=>({SheetNames:['원본'],Sheets:{'원본':ws}}),utils:{decode_range:()=>({s:{r:0,c:0},e:{r:998,c:22}}),encode_cell:({r,c})=>String.fromCharCode(65+c)+(r+1),format_cell:cell=>String(cell.v??'')}};
 const result=previewSpreadsheet(file,{parser,start:70});assert.equal(result.columns,5);assert.equal(result.totalRows,92);assert.equal(result.rows.at(-1).cells[4],'마지막 내용');assert.equal(result.merges[0].e.r,89);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
