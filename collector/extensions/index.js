const { setDataSigner } = require("../middleware/setDataSigner");
const { verifyPayloadIntegrity } = require("../middleware/verifyIntegrity");
const { reqBody } = require("../utils/http");
const RESYNC_METHODS = require("./resync");

function extensions(app) {
  if (!app) return;

  app.post(
    "/ext/resync-source-document",
    [verifyPayloadIntegrity, setDataSigner],
    async function (request, response) {
      try {
        const { type, options } = reqBody(request);
        if (!RESYNC_METHODS.hasOwnProperty(type))
          throw new Error(`Type "${type}" is not a valid type to sync.`);
        return await RESYNC_METHODS[type](options, response);
      } catch (e) {
        console.error(e);
        response.status(200).json({
          success: false,
          content: null,
          reason: e.message || "A processing error occurred.",
        });
      }
    }
  );
}

module.exports = extensions;
