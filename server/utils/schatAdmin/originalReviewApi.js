const {createOriginalReviewGate}=require('./originalReferenceReview');
function createOriginalReviewApi({loadReport,body}) {
  const gate=createOriginalReviewGate();
  return {
    async preview(request,response) {
      const {keys}=body(request);
      if(!Array.isArray(keys)||!keys.length||keys.length>100||keys.some(key=>typeof key!=='string'))
        return response.status(400).json({ok:false,message:'원본 PDF를 선택해 주세요.'});
      try {
        const result=gate.issue(response.locals?.user?.id??null,keys,await loadReport());
        return response.status(result.ok?200:409).json(result);
      } catch {
        return response.status(503).json({ok:false,message:'연결 정보를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.'});
      }
    },
    verify(response,{keys,previewToken},report) {
      return gate.consume(response.locals?.user?.id??null,keys,previewToken,report);
    },
  };
}
module.exports={createOriginalReviewApi};
