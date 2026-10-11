const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
function handleDocumentUpdateUpload(request,response,next) {
  const multer=require('multer');
  const destination=process.env.NODE_ENV==='development'
    ? path.resolve(__dirname,'../../../collector/hotdir')
    : path.resolve(process.env.STORAGE_DIR,'../../collector/hotdir');
  const storage=multer.diskStorage({
    destination:(_,__,done)=>done(null,destination),
    filename:(_,file,done)=>{
      file.originalname=Buffer.from(file.originalname,'latin1').toString('utf8');
      done(null,`document-update-${randomUUID()}.pdf`);
    },
  });
  multer({storage,limits:{files:50,fileSize:100*1024*1024,fieldSize:1024*1024},
    fileFilter:(_,file,done)=>done(/\.pdf$/i.test(file.originalname)?null:new Error('PDF_ONLY'),true)
  }).array('files',50)(request,response,error=>{
    if (error) return response.status(422).json({success:false,code:'UPDATE_UPLOAD_REJECTED',error:'문서 업데이트는 PDF 묶음만 지원합니다. 파일 크기와 형식을 확인해주세요.'});
    next();
  });
}
async function cleanupIncoming(files=[]) {
  for (const file of files) await fs.promises.unlink(file.path).catch(error=>{
    if(error.code!=='ENOENT') console.error('Document update upload cleanup failed:',error.code);
  });
}
module.exports={handleDocumentUpdateUpload,cleanupIncoming};
