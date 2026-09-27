const path = require("path");

const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function resolveWorkspaceImage({ imageKey, storageRoot, documents = [] }) {
  if (!IMAGE_KEY_PATTERN.test(String(imageKey || ""))) return null;
  for (const document of documents) {
    let metadata;
    try {
      metadata =
        typeof document.metadata === "string"
          ? JSON.parse(document.metadata)
          : document.metadata;
    } catch {
      continue;
    }
    if (!Array.isArray(metadata?.pdf_images)) continue;
    const image = metadata.pdf_images.find(
      (candidate) => candidate?.image_key === imageKey
    );
    if (!image || typeof image.storage_relative_path !== "string") continue;
    const resolved = path.resolve(storageRoot, image.storage_relative_path);
    if (!isWithin(storageRoot, resolved) || path.extname(resolved) !== ".png")
      return null;
    return resolved;
  }
  return null;
}

module.exports = { IMAGE_KEY_PATTERN, resolveWorkspaceImage };
