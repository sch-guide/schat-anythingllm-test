const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto");
function persistSpreadsheet({sourcePath,documentId,filename,storageRoot}) {
 const extension=path.extname(filename).toLowerCase();
 if(![".xlsx",".xls"].includes(extension)||!documentId)throw Error("INVALID_SPREADSHEET");
 const key=createHash("sha256").update(String(documentId)).digest("hex");
 fs.mkdirSync(storageRoot,{recursive:true});
 const filePath=path.join(storageRoot,key+extension);
 fs.copyFileSync(sourcePath,filePath,fs.constants.COPYFILE_EXCL);
 try {fs.writeFileSync(path.join(storageRoot,key+".json"),JSON.stringify({filename:path.basename(filename),extension}),{flag:"wx",mode:0o600});}
 catch(error){fs.unlinkSync(filePath);throw error;}
 return filePath;
}
module.exports={persistSpreadsheet};
