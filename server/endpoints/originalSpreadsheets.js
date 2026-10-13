const {validatedRequest}=require("../utils/middleware/validatedRequest");
const {flexUserRoleValid,ROLES}=require("../utils/middleware/multiUserProtected");
const {validWorkspaceSlug}=require("../utils/middleware/validWorkspace");
const {Document}=require("../models/documents");
const {resolveSpreadsheet,previewStyledSpreadsheet}=require("../utils/originalSpreadsheet");
module.exports=function originalSpreadsheetEndpoints(app){
 app.get("/workspace/:slug/original-spreadsheet/:sheetRef",
  [validatedRequest,flexUserRoleValid([ROLES.all]),validWorkspaceSlug],async(req,res)=>{
   if(Object.prototype.hasOwnProperty.call(req.query,"download"))
    return res.status(403).json({error:"엑셀 원본은 화면 보기만 제공하며 다운로드할 수 없습니다."});
   try{
    const docs=(await Document.forWorkspace(res.locals.workspace.id)).filter(d=>{
     try{return JSON.parse(d.metadata).schat_document_update_archived!==true;}catch{return false;}
    });
    const original=resolveSpreadsheet({ref:req.params.sheetRef,documents:docs});
    if(!original)return res.status(404).json({error:"엑셀 원본이 보관되지 않았거나 접근할 수 없습니다. 새 이름으로 다시 등록해 주세요."});
    res.setHeader("Cache-Control","private, no-store");
    const preview=await previewStyledSpreadsheet(original.filePath,{sheet:req.query.sheet,start:req.query.start});
    return res.json(preview);
   }catch(error){
    if(error.message==="SPREADSHEET_TOO_LARGE")return res.status(413).json({error:"원본이 20MB를 넘어 표 미리보기를 제공하지 않습니다. 관리자에게 문의해 주세요."});
    return res.status(error.message==="SHEET_NOT_FOUND"?404:500).json({error:"엑셀 원본을 읽지 못했습니다. 잠시 후 다시 시도해 주세요."});
   }
  });
};
