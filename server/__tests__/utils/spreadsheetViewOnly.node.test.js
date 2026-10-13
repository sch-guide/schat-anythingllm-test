const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function endpoint(){let handler;const noop=()=>{};const mocks={
 '../utils/middleware/validatedRequest':{validatedRequest:noop},
 '../utils/middleware/multiUserProtected':{flexUserRoleValid:()=>noop,ROLES:{all:'all'}},
 '../utils/middleware/validWorkspace':{validWorkspaceSlug:noop},
 '../models/documents':{Document:{forWorkspace:async()=>[{metadata:'{}'}]}},
 '../utils/originalSpreadsheet':{resolveSpreadsheet:()=>({filePath:'private.xlsx',filename:'private.xlsx'}),previewStyledSpreadsheet:()=>({sheets:['Sheet1'],rows:[]})}
};const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../endpoints/originalSpreadsheets.js'),'utf8'),{module,require:n=>mocks[n]});module.exports({get:(url,middleware,fn)=>handler=fn});return handler;}
test('직원·관리자 모두 직접 엑셀 다운로드 요청은 차단하고 표 JSON만 허용',async()=>{
 for(const role of ['default','admin'])for(const query of [{download:'1'},{download:'true'},{download:'0'},{}]){
 const res={locals:{workspace:{id:1},user:{role}},code:200,status(n){this.code=n;return this},json(v){this.body=v;return this},setHeader(){},download(){this.binary=true;return this}};
 await endpoint()({params:{sheetRef:'ref'},query},res);
 assert.equal(res.code,Object.hasOwn(query,'download')?403:200);assert.ok(!res.binary);if(!Object.hasOwn(query,'download'))assert.ok(Array.isArray(res.body.rows));
 }
});
