const fs = require("fs");
const path = require("path");
const {
  purgeVectorCache,
  purgeSourceDocument,
  normalizePath,
  isWithin,
  documentsPath,
} = require(".");
const { Document } = require("../../models/documents");
const { Workspace } = require("../../models/workspace");
const prisma = require("../../utils/prisma");
const { isArchivedDocument } = require("../documentUpdates/archive");
const { guard } = require("../documentUpdates/guard");

async function assertNoArchivedReferences(docpaths) {
  // Fail closed on DB read errors: retained references protect historical sources.
  const references = await prisma.workspace_documents.findMany({
    where: { docpath: { in: docpaths } },
  });
  if (references.some(isArchivedDocument)) throw new Error("ARCHIVED_DOCUMENT_PROTECTED");
}

async function purgeDocument(filename = null) {
  if (!filename || !normalizePath(filename)) return;
  await assertNoArchivedReferences([normalizePath(filename).replace(/\\/g, "/")]);

  await purgeVectorCache(filename);
  await purgeSourceDocument(filename);
  const workspaces = await Workspace.where();
  for (const workspace of workspaces) {
    await Document.removeDocuments(workspace, [filename]);
  }
  return;
}

/**
 * Purge a folder and all its contents. This will also remove all vector-cache files and workspace document associations
 * for the documents within the folder.
 * @notice This function is not recursive. It only purges the contents of the specified folder.
 * @notice You cannot purge the `custom-documents` folder.
 * @param {string} folderName - The name/path of the folder to purge.
 * @returns {Promise<void>}
 */
async function purgeFolder(folderName = null) {
  if (!folderName) return;
  const subFolder = normalizePath(folderName);
  const subFolderPath = path.resolve(documentsPath, subFolder);
  const validRemovableSubFolders = fs
    .readdirSync(documentsPath)
    .map((folder) => {
      // Filter out any results which are not folders or
      // are the protected custom-documents folder.
      if (folder === "custom-documents") return null;
      const subfolderPath = path.resolve(documentsPath, folder);
      if (!fs.lstatSync(subfolderPath).isDirectory()) return null;
      return folder;
    })
    .filter((subFolder) => !!subFolder);

  if (
    !validRemovableSubFolders.includes(subFolder) ||
    !fs.existsSync(subFolderPath) ||
    !isWithin(documentsPath, subFolderPath)
  )
    return;

  const filenames = fs
    .readdirSync(subFolderPath)
    .map((file) =>
      path.relative(documentsPath, path.join(subFolderPath, file)).replace(/\\/g, "/")
    );
  await assertNoArchivedReferences(filenames);
  const workspaces = await Workspace.where();

  const purgePromises = [];
  // Remove associated Vector-cache files
  for (const filename of filenames) {
    const rmVectorCache = () =>
      new Promise((resolve) =>
        purgeVectorCache(filename).then(() => resolve(true))
      );
    purgePromises.push(rmVectorCache);
  }

  // Remove workspace document associations
  for (const workspace of workspaces) {
    const rmWorkspaceDoc = () =>
      new Promise((resolve) =>
        Document.removeDocuments(workspace, filenames).then(() => resolve(true))
      );
    purgePromises.push(rmWorkspaceDoc);
  }

  await Promise.all(purgePromises.flat().map((f) => f()));
  fs.rmSync(subFolderPath, { recursive: true }); // Delete target document-folder and source files.

  return;
}

async function withDocumentPaths(paths,operation) {
  if(!paths.length)return operation();
  const {pathKeys,workspaceKey}=require('../documentUpdates/scopes');
  const rows=await prisma.workspace_documents.findMany({where:{docpath:{in:paths}}});
  const keys=[...await pathKeys(paths),...rows.map(row=>workspaceKey(row.workspaceId))];
  return guard.read(operation,keys);
}
module.exports = {
  purgeDocument: filename => filename
    ? withDocumentPaths([normalizePath(filename).replace(/\\/g,'/')],()=>purgeDocument(filename)) : purgeDocument(filename),
  purgeFolder: async folderName => {
    if(!folderName)return;
    const target=path.resolve(documentsPath,normalizePath(folderName));
    if(!isWithin(documentsPath,target))return;
    const filenames=fs.readdirSync(target).map(file=>path.relative(documentsPath,path.join(target,file)).replace(/\\/g,'/'));
    return withDocumentPaths(filenames,()=>purgeFolder(folderName));
  },
};
