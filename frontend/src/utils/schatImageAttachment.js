export const SCHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const IMAGE_FILE_EXTENSION = /\.(?:jpe?g|png|webp|gif|bmp|tiff?)$/i;

export function validateSchatImageFile(file, existingImageCount = 0) {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "");
  const looksLikeImage = mime.startsWith("image/") || IMAGE_FILE_EXTENSION.test(name);
  if (!looksLikeImage) return { isImage: false, error: null };
  if (!SUPPORTED_IMAGE_TYPES.has(mime)) {
    return {
      isImage: true,
      error: "이미지는 JPG, PNG, WebP 형식만 첨부할 수 있습니다.",
    };
  }
  if (existingImageCount >= 1) {
    return { isImage: true, error: "이미지는 한 번에 1장만 첨부할 수 있습니다." };
  }
  if (!Number.isFinite(file?.size) || file.size > SCHAT_MAX_IMAGE_BYTES) {
    return { isImage: true, error: "이미지는 5MB 이하만 첨부할 수 있습니다." };
  }
  return { isImage: true, error: null };
}
