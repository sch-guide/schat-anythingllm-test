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
test('usage screen starts with a collapsed department picker and no query button',async()=>{
  const m=await compile(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import Usage from './src/pages/SchatAdmin/sections/UsageStats.jsx'; export const html=renderToStaticMarkup(<Usage/>);`);
  assert.match(m.html,/날짜 직접 선택/);
  assert.match(m.html,/대상 부서/);
  assert.match(m.html,/전체 부서/);
  assert.match(m.html,/aria-expanded="false"/);
  assert.doesNotMatch(m.html,/>조회<|type="submit"|토큰/);
  assert.doesNotMatch(m.html,/워크스페이스 삭제/);
});
test('department groups keep all departments and filter case-insensitively',async()=>{
  const m=await compile(`export { groupDepartments, selectionError } from './src/pages/SchatAdmin/usageSelection.js';`);
  const items=[{id:1,name:'61병동'},{id:2,name:'MICU'},{id:3,name:'성인ER'},{id:4,name:'간호교육파트'},{id:5,name:'NICU'}];
  assert.deepEqual(m.groupDepartments(items,'').map(g=>[g.name,g.items.map(d=>d.id)]),[
    ['병동',[1]],['중환자실',[2,5]],['응급·수술',[3]],['기타',[4]],
  ]);
  assert.deepEqual(m.groupDepartments(items,' micu ').flatMap(g=>g.items.map(d=>d.id)),[2]);
  assert.equal(m.selectionError('custom','2026-10-12','2026-10-11','2026-10-11').length>0,true);
  assert.equal(m.selectionError('custom','','2026-10-11','2026-10-11').length>0,true);
  assert.equal(m.selectionError('7d','','','2026-10-11'),'');
});
test('department selection, tag removal and search call the real picker callbacks',async()=>{
  const m=await compile(`import React from 'react'; import {DepartmentPickerView} from './src/pages/SchatAdmin/DepartmentPicker.jsx';
    export function scenario(){
      let selected=[1], query='', opened=false;
      const departments=[{id:1,name:'61병동'},{id:2,name:'MICU'}];
      const draw=()=>DepartmentPickerView({departments,selected,onChange:v=>selected=v,open:true,setOpen:v=>opened=v,query,setQuery:v=>query=v,id:'pick'});
      const all=(node)=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(all)];
      all(draw()).find(n=>n.type==='input'&&n.props.type==='checkbox'&&!n.props.checked).props.onChange();
      const afterAdd=[...selected];
      all(draw()).find(n=>n.props['aria-label']==='61병동 선택 해제').props.onClick();
      const afterRemove=[...selected];
      all(draw()).find(n=>n.props['aria-label']==='부서 이름으로 찾기').props.onChange({target:{value:'micu'}});
      const visible=all(draw()).filter(n=>n.type==='input'&&n.props.type==='checkbox').length;
      all(draw()).find(n=>n.props.onKeyDown).props.onKeyDown({key:'Escape'});
      return {afterAdd,afterRemove,visible,opened};
    }`);
  assert.deepEqual(m.scenario(),{afterAdd:[1,2],afterRemove:[2],visible:1,opened:false});
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
