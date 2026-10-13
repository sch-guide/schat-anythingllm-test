import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('원본 표 요청은 실제로 JSON을 가져오고 다운로드 옵션을 보내지 않음',async()=>{
 const source=fs.readFileSync(new URL('./files.js',import.meta.url),'utf8');
 const method=source.match(/originalSpreadsheet:\s*(async function[\s\S]*?\n\s*}),/)[1];let url;
 const fetch=async value=>{url=value;return {ok:true,json:async()=>({rows:[]})}};
 const fn=vm.runInNewContext('('+method+')',{URLSearchParams,fetch,API_BASE:'/api',baseHeaders:()=>({})});
 assert.deepEqual(JSON.parse(JSON.stringify(await fn('workspace','ref',{sheet:'Sheet2',start:151,download:true}))),{rows:[]});
 assert.match(url,/sheet=Sheet2/);assert.match(url,/start=151/);assert.doesNotMatch(url,/download/);
});
