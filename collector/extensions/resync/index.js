const { getLinkText } = require("../../processLink");

/**
 * Fetch the current content of a generic URL document.
 * @param {{link: string}} data
 * @param {import("../../middleware/setDataSigner").ResponseWithSigner} response
 */
async function resyncLink({ link }, response) {
  if (!link) throw new Error("Invalid link provided");
  try {
    const { success, content = null, reason } = await getLinkText(link);
    if (!success) throw new Error(`Failed to sync link content. ${reason}`);
    response.status(200).json({ success, content });
  } catch (e) {
    console.error(e);
    response.status(200).json({
      success: false,
      content: null,
    });
  }
}

module.exports = { link: resyncLink };
