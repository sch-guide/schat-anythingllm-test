const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;

function parseImageKeys(source = {}) {
  if (IMAGE_KEY_PATTERN.test(String(source.image_key || ""))) {
    return [source.image_key];
  }
  return [];
}

function collectRelatedImages(sources = [], maximum = 3) {
  if (!Array.isArray(sources)) return [];
  const images = [];
  const seen = new Set();
  for (const source of sources) {
    for (const imageKey of parseImageKeys(source)) {
      if (seen.has(imageKey)) continue;
      seen.add(imageKey);
      images.push({
        imageKey,
        documentName: String(
          source.document_name || source.documentName || source.title || ""
        )
          .split(/[\\/]/)
          .pop(),
        page:
          Number.isInteger(source.page) && source.page > 0 ? source.page : null,
        section: typeof source.section === "string" ? source.section.trim() : "",
        matchType: "image_description",
      });
      if (images.length >= maximum) return images;
    }
  }
  return images;
}

module.exports = { collectRelatedImages, parseImageKeys };
