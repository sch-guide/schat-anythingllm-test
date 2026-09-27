const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;

export function buildRelatedImagesModel(images = []) {
  if (!Array.isArray(images)) return [];
  const seen = new Set();
  const model = [];
  for (const image of images) {
    if (!["image_description", "source_unit"].includes(image?.matchType))
      continue;
    const imageKey = String(image?.imageKey || "");
    if (!IMAGE_KEY_PATTERN.test(imageKey) || seen.has(imageKey)) continue;
    seen.add(imageKey);
    const page = Number.isInteger(image.page) && image.page > 0 ? image.page : null;
    const section = typeof image.section === "string" ? image.section.trim() : "";
    const documentName =
      typeof image.documentName === "string" ? image.documentName.trim() : "";
    const label = [page ? `p.${page}` : null, section || null]
      .filter(Boolean)
      .join(" · ");
    model.push({
      imageKey,
      label: label || documentName || "관련 이미지",
      alt: [documentName, page ? `p.${page}` : null, section || null, "관련 이미지"]
        .filter(Boolean)
        .join(" "),
    });
    if (model.length === 3) break;
  }
  return model;
}
