import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
test('deleted PDF response stays distinct from a general failure',async()=>{
 const m={exports:{}};let status=410;
 vm.runInNewContext(transformSync(readFileSync(new URL('./files.js',import.meta.url),'utf8'),{format:'cjs'}).code,{
  module:m,exports:m.exports,require:()=>({API_BASE:'/api',baseHeaders:()=>({})}),console:{error(){}},
  fetch:async()=>({status,ok:false,json:async()=>({code:'ORIGINAL_PDF_DELETED'})}),
 });
 assert.equal((await m.exports.default.originalPdf('test','fake')).deleted,true);
 status=404;assert.equal(await m.exports.default.originalPdf('test','fake'),null);
});
