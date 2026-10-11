import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const require=createRequire(import.meta.url),React=require('react');
test('original review shows reference counts before a confirmed deletion and sends its ticket',async()=>{
 let slot=0;const values=[];const calls=[];
 const m={exports:{}};
 const ui={};for(const name of ['Card','Button','Badge','InfoRow','Notice'])ui[name]=name.toLowerCase();
 const mockReact={...React,useState:initial=>{const i=slot++;if(!(i in values))values[i]=initial;return [values[i],value=>values[i]=typeof value==='function'?value(values[i]):value];},useEffect(){}};
 const deps={react:mockReact,'../ui':ui,'@/components/lib/Modal':{__esModule:true,default:'modal',ModalBody:'modal-body',ModalHeader:'modal-header'},'@/utils/toast':{__esModule:true,default:()=>{}},'@/models/schatAdmin':{__esModule:true,default:{
  storagePreviewOriginals:async keys=>{calls.push(['preview',keys]);return {ok:true,previewToken:'fake-ticket',items:[{key:'old',counts:{chats:2,quizSets:1}}]};},
  storageDeleteOriginals:async(...args)=>{calls.push(['delete',...args]);return {ok:true,deleted:1};},
 }}};
 vm.runInNewContext(transformSync(readFileSync(new URL('./sections/Storage.jsx',import.meta.url),'utf8'),{format:'cjs',loader:'jsx',jsx:'automatic'}).code,{module:m,exports:m.exports,require:name=>deps[name]||require(name)});
 assert.equal(typeof m.exports.OriginalPdfCard,'function');
 const draw=()=>{slot=0;return m.exports.OriginalPdfCard({groups:[{key:'old',label:'시험 PDF',status:'review',references:{counts:{chats:2}}}],onDone:()=>{}});};
 const nodes=node=>React.isValidElement(node)?[node,...React.Children.toArray(node.props.children).flatMap(nodes)]:[];
 let tree=draw();let checkbox=nodes(tree).find(n=>n.type==='input');assert.equal(checkbox.props.disabled,false);
 checkbox.props.onChange({target:{checked:true}});tree=draw();
 await nodes(tree).find(n=>n.props.children==='선택한 파일 확인').props.onClick();tree=draw();
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['preview',['old']]]);
 assert.match(JSON.stringify(tree),/대화/);assert.match(JSON.stringify(tree),/퀴즈/);
 await nodes(tree).find(n=>n.props.children==='그래도 삭제').props.onClick();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),['delete',['old'],'fake-ticket']);
});
