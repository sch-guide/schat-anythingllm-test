// Catalog concurrency, crash recovery and isolated integration passed review.
// This release gate precedes file receipt; request validation and scoped locks
// still apply to every update. It is not an environment-variable override.
const DOCUMENT_UPDATE_READY = true;
function requireDocumentUpdateReady(_request,response,next) {
  if (DOCUMENT_UPDATE_READY) return next();
  return response.status(503).json({success:false,code:'DOCUMENT_UPDATE_NOT_READY',
    error:'안전 검증이 끝나지 않아 업데이트를 사용할 수 없습니다.'});
}
module.exports={requireDocumentUpdateReady};
