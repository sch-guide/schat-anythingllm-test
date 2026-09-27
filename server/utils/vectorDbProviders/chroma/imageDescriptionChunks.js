const IMAGE_KEY_PATTERN = /^[a-f0-9]{64}$/;

function buildImageDescriptionChunks({ images = [], metadata = {} } = {}) {
  if (!Array.isArray(images)) return [];
  return images
    .filter(
      (image) =>
        image &&
        IMAGE_KEY_PATTERN.test(String(image.image_key || "")) &&
        typeof image.description === "string" &&
        image.description.trim()
    )
    .map((image) => ({
      text: image.description.trim(),
      metadata: {
        ...metadata,
        content_type: "image_description",
        image_key: image.image_key,
      },
    }));
}

module.exports = { buildImageDescriptionChunks };
