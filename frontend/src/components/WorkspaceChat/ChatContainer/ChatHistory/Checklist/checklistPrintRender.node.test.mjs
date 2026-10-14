import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../../../..");
test("실제 공통 화면은 제목 체크 없이 기존 세부·단독 저장 상태를 표시",async()=>{
 const result=await build({stdin:{contents:`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Tree from './src/components/WorkspaceChat/ChatContainer/ChatHistory/Checklist/ChecklistTree.jsx'; export const html=renderToStaticMarkup(<Tree checklist={{id:'c',sections:[{id:'s',title:'전',items:[{id:'i',label:'식이',type:'checkable',details:['금식','물']},{id:'x',label:'단독',type:'checkable',details:[]}]}]}} checkedItems={{'c:s:i:0':true,'c:s:x:self':true}}/>);`,resolveDir:root,loader:"jsx"},bundle:true,write:false,platform:"node",format:"cjs",jsx:"automatic",alias:{"@":path.join(root,"src")},define:{"process.env.NODE_ENV":'"production"'}});
 const module={exports:{}};new Function("module","exports","require","React",result.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url),createRequire(import.meta.url)("react"));const html=module.exports.html;
 assert.equal((html.match(/type="checkbox"/g)||[]).length,3);assert.equal((html.match(/checked=""/g)||[]).length,2);
 assert.doesNotMatch(html,/aria-label="식이 전체"/);assert.match(html,/line-through/);
});
