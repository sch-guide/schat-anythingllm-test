import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const require=createRequire(import.meta.url);
async function compile(contents) {
  const result=await build({stdin:{contents,resolveDir:root,loader:'jsx'},bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',inject:['test-react-inject'],alias:{'@':path.join(root,'src')},define:{'import.meta.env.VITE_API_BASE':'"/api"'},plugins:[{name:'request-headers',setup(api){
    api.onResolve({filter:/^test-react-inject$/},()=>({path:'test-react-inject',namespace:'test-react'}));
    api.onLoad({filter:/.*/,namespace:'test-react'},()=>({contents:'import React from "react"; export { React };',loader:'js',resolveDir:root}));
    api.onLoad({filter:/utils[\\/]request\.js$/},()=>({contents:'export function baseHeaders(){return {}}',loader:'js'}));
  }}]});
  const m={exports:{}};
  new Function('module','exports','require',result.outputFiles[0].text)(m,m.exports,require);
  return m.exports;
}
test('usage screen renders date selection, department selection and explicit query without deleting data',async()=>{
  const m=await compile(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Usage from './src/pages/SchatAdmin/sections/UsageStats.jsx'; export const html=renderToStaticMarkup(<Usage/>);`);
  assert.match(m.html,/날짜 직접 선택/);
  assert.match(m.html,/대상 부서/);
  assert.match(m.html,/전체 부서/);
  assert.match(m.html,/조회/);
  assert.doesNotMatch(m.html,/워크스페이스 삭제/);
});
test('request sends dates and multiple departments as read-only query parameters',async()=>{
  const m=await compile(`import Model from './src/models/schatAdmin.js'; export const usage=Model.usageStats;`);
  const previous=globalThis.fetch;
  const requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({questions:{total:10}})};};
  try {
    const response=await m.usage('custom',{startDate:'2026-10-01',endDate:'2026-10-10',departmentIds:[10,20]});
    const url=new URL(requests[0].url,'http://localhost');
    assert.equal(url.searchParams.get('startDate'),'2026-10-01');
    assert.equal(url.searchParams.get('endDate'),'2026-10-10');
    assert.equal(url.searchParams.get('departments'),'10,20');
    assert.equal(requests[0].options.method,'GET');
    assert.equal(response.questions.total,10);
  } finally {globalThis.fetch=previous;}
});
