const test=require("node:test");
const assert=require("node:assert/strict");
const AIbitat=require("../../../../utils/agents/aibitat");
const {buildRagContext}=require("../../../../utils/agents/aibitat/utils/ragSources");
const {evidenceSourceId}=require("../../../../utils/agents/aibitat/utils/evidenceQuotes");
const {WorkspaceChats}=require("../../../../models/workspaceChats");
const {chatHistory}=require("../../../../utils/agents/aibitat/plugins/chat-history");
for(const streaming of [false,true]) test(`synthetic procedure evidence reaches citations and saved history (stream=${streaming})`,async()=>{
 const ai=new AIbitat({provider:"openai",handlerProps:{log(){},invocation:{workspace_id:1,workspace:{},user_id:1}}});
 const raw={id:"test-chunk",document_name:"synthetic.txt",page:1,text:"검사용 도구를 준비한다. 검사용 표시를 확인한다. 관계없는 항목은 제외한다."};
 ai.addRagMemorySources([raw]);
 const source=ai.getRagMemorySources()[0];
 const id=evidenceSourceId(source);
 assert.ok(buildRagContext([raw]).includes(id));
 const quote="검사용 표시를 확인한다.";
 const answer="테스트 절차가 끝나면 표시 상태를 살펴보세요.";
 const payload=answer+"<schat_evidence>"+JSON.stringify({quotes:[{source_id:id,text:quote}]})+"</schat_evidence>";
 const events=[];
 ai.socket={send:(type,data)=>events.push(data)};
 ai.providerInstance={resetCumulativeUsage(){},getCumulativeUsage:()=>({}),isModelLoaded:async()=>true,complete:async()=>({uuid:"fixture",textResponse:payload}),stream:async(messages,functions,send)=>{send("reportStreamEvent",{type:"textResponseChunk",uuid:"fixture",content:payload});return {uuid:"fixture",textResponse:payload};}};
 const messages=[{role:"user",content:"항생제 반응검사 절차 알려줘"}];
 const result=streaming ? await ai.handleAsyncExecution(messages,[]) : await ai.handleExecution(messages,[]);
 assert.equal(result,answer);
 assert.deepEqual(events.find(event=>event.type==="citations").citations[0].evidenceQuotes,[quote]);
 assert.doesNotMatch(events.filter(event=>event.type==="textResponseChunk").map(event=>event.content).join(""),/schat_evidence/);
 const previous=WorkspaceChats.upsert;
 let saved;
 WorkspaceChats.upsert=async(id,data)=>{saved=data;return {};};
 try {
 const history=chatHistory.plugin();
 history._autoRenameThread=async()=>false;
 history._cleanup=()=>{};
 await history._store(ai,{prompt:messages[0].content,response:result});
 assert.equal(saved.response.text,answer);
 assert.deepEqual(saved.response.sources[0].evidenceQuotes,[quote]);
 } finally {WorkspaceChats.upsert=previous;}
});
