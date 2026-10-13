import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
test("원본 표의 열·행·병합·앞자리0·형광과 HTML 이스케이프를 렌더링",async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../../../..");
 const tmp=await mkdtemp(path.join(tmpdir(),"schat-sheet-grid-"));
 try{
  const inject=path.join(tmp,"react.js");await writeFile(inject,'import React from "react"; export {React};');
  await build({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {SpreadsheetGrid,SpreadsheetPreview} from './src/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/SpreadsheetViewer.jsx'; export function render(data){return renderToStaticMarkup(React.createElement(SpreadsheetGrid,{data,evidenceCells:[{row:2,column:1,texts:["0123<script>"]}]}));} export function preview(data,mark=true){return renderToStaticMarkup(React.createElement(SpreadsheetPreview,{data,evidenceCells:mark?[{row:2,column:1,texts:["0123"]}]:[]}));}`,resolveDir:root,loader:"jsx"},bundle:true,platform:"node",format:"cjs",outfile:path.join(tmp,"fixture.cjs"),inject:[inject],nodePaths:[path.join(root,"node_modules")],define:{"import.meta.env":"{}"},alias:{"@":path.join(root,"src")},loader:{".png":"dataurl",".svg":"dataurl"}});
  const {render,preview}=await import(pathToFileURL(path.join(tmp,"fixture.cjs")));
  const html=render({start:0,columns:2,rows:[{row:1,cells:["가상부서","성명"]},{row:2,cells:["","0123<script>"]}],merges:[{s:{r:0,c:0},e:{r:1,c:0},value:"가상부서"}]});
  const data={sheet:"Sheet1",sheets:["Sheet1"],start:0,totalRows:2,columns:2,columnWidths:[152,89],rows:[{row:1,height:40,cells:["가상부서","성명"]},{row:2,height:22,cells:["가나다","0123"],styles:[{},{backgroundColor:"#FFCC00",fontWeight:"bold",textAlign:"right"}]}],merges:[]};
  const single=preview(data),multi=preview({...data,sheets:["Sheet1","Sheet2"]});
  assert.doesNotMatch(single,/<select|Sheet1|다운로드|근거 원문|원본 셀 배치|아래는|<input|contenteditable/i);
  assert.match(single,/<table/);assert.match(single,/data-answer-evidence="true"/);
  assert.match(single,/background-color:#FFCC00/);assert.doesNotMatch(single,/background-image|box-shadow/);
  assert.match(single,/<mark[^>]*background-color:#e6f7c8[^>]*>0123<\/mark>/);
  assert.match(single,/transform:scale\(0.75\)/);assert.match(single,/overflow-auto/);assert.match(single,/overflow:hidden/);assert.match(single,/margin:0 auto/);assert.match(single,/overflow-wrap:anywhere/);assert.doesNotMatch(single,/<td[^>]*overflow:hidden/);
  assert.doesNotMatch(single,/<td[^>]*data-answer-evidence/);assert.match(single,/width:152px/);assert.match(single,/height:40px/);
  assert.doesNotMatch(single,/<thead|<th[ >]/);assert.equal((single.match(/data-answer-evidence="true"/g)||[]).length,1);
  assert.doesNotMatch(preview(data,false),/data-answer-evidence|linear-gradient/);
  const narrow=preview({...data,columnWidths:[20,80],rows:[{row:1,height:20,cells:["아주 긴 부서 이름", "6741"],styles:[{whiteSpace:"pre"},{whiteSpace:"pre"}]}]},false);
  assert.doesNotMatch(narrow,/white-space:pre;/);assert.match(narrow,/white-space:pre-wrap/);
  assert.match(multi,/<select/);assert.match(multi,/<option[^>]*>Sheet2/);
  assert.match(html,/rowSpan="2"/i);
  assert.match(html,/data-answer-evidence="true"/);
  assert.match(html,/0123&lt;script&gt;/);
  assert.equal((html.match(/가상부서/g)||[]).length,1);
 }finally{assert.equal(path.dirname(tmp),tmpdir());await rm(tmp,{recursive:true,force:true});}
});
