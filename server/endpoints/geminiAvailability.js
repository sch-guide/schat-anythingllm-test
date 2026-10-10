const { validatedRequest } = require('../utils/middleware/validatedRequest');
const { flexUserRoleValid, ROLES } = require('../utils/middleware/multiUserProtected');
const { monitor } = require('../utils/geminiAvailability');

function geminiAvailabilityEndpoints(app) {
  app.get('/schat-admin/gemini-availability',
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    (_request, response) => {
      response.set('Cache-Control', 'no-store');
      response.status(200).json({alerts: monitor.snapshot()});
    });
}
module.exports = { geminiAvailabilityEndpoints };
