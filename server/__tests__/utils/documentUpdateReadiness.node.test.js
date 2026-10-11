const test=require('node:test');
const assert=require('node:assert/strict');
const {requireDocumentUpdateReady}=require('../../utils/documentUpdates/readiness');
test('검토 완료 준비 경계는 파일 수신 전에 다음 단계로 진행한다',()=>{
  let advanced=0;
  const request={};
  const response={status(){assert.fail('준비 완료 경계에서 거절 응답을 보내면 안 된다');}};
  requireDocumentUpdateReady(request,response,()=>{
    assert.equal(request.files,undefined);
    advanced++;
  });
  assert.equal(advanced,1);
});
