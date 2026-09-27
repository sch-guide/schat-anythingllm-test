import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const StorageFiles = {
  /**
   * Download a file from the server
   * @param {string} filename - The filename to download
   * @returns {Promise<Blob|null>}
   */
  download: async function (storageFilename) {
    return await fetch(
      `${API_BASE}/agent-skills/generated-files/${encodeURIComponent(storageFilename)}`,
      { headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to download file");
        return res.blob();
      })
      .catch((e) => {
        console.error("Download failed:", e);
        return null;
      });
  },

  /**
   * Fetch a generated image as a Blob. The serve endpoint is auth-protected, so
   * we cannot use the URL directly as an <img> src - callers create an object URL.
   * @param {string} storageFilename - The image filename to fetch
   * @returns {Promise<Blob|null>}
   */
  image: async function (storageFilename) {
    return await fetch(
      `${API_BASE}/image-generation/generated-images/${encodeURIComponent(storageFilename)}`,
      { headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch image");
        return res.blob();
      })
      .catch((e) => {
        console.error("Image fetch failed:", e);
        return null;
      });
  },

  documentImage: async function (workspaceSlug, imageKey) {
    return await fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/document-image/${encodeURIComponent(imageKey)}`,
      { headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch document image");
        return res.blob();
      })
      .catch((error) => {
        console.error("Document image fetch failed:", error);
        return null;
      });
  },

  originalPdf: async function (workspaceSlug, pdfRef) {
    return await fetch(
      `${API_BASE}/workspace/${encodeURIComponent(workspaceSlug)}/original-pdf/${encodeURIComponent(pdfRef)}`,
      { headers: baseHeaders() }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch original PDF");
        return res.blob();
      })
      .catch((error) => {
        console.error("Original PDF fetch failed:", error);
        return null;
      });
  },
};

export default StorageFiles;
