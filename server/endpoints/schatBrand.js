const { SystemSettings } = require("../models/systemSettings");
const {
  defaults,
  validateSection,
  publicBrand,
} = require("../utils/schatBrand");
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");

// One existing settings row, with a dedicated public allowlist and admin writes.
function schatBrandEndpoints(app) {
  let saving = false;
  app.get("/system/schat-brand", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const row = await SystemSettings.get({ label: "schat_brand" });
      res.status(200).json({ brand: publicBrand(row?.value) });
    } catch {
      res.status(503).json({ error: "브랜드 설정을 불러오지 못했습니다." });
    }
  });
  app.put(
    "/system/schat-brand",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      if (saving)
        return res
          .status(409)
          .json({ error: "다른 저장이 진행 중입니다. 다시 시도해 주세요." });
      let body, value;
      try {
        body = reqBody(req);
        if (!body || !Object.hasOwn(defaults(), body.section))
          throw Error("변경할 브랜드 항목을 확인해 주세요.");
        value =
          body.reset === true
            ? defaults()[body.section]
            : validateSection(body.section, body.value);
      } catch (error) {
        return res
          .status(400)
          .json({ error: error.message || "브랜드 설정을 확인해 주세요." });
      }
      saving = true;
      try {
        const row = await SystemSettings.get({ label: "schat_brand" });
        const brand = { ...publicBrand(row?.value), [body.section]: value };
        const result = await SystemSettings._updateSettings({
          schat_brand: JSON.stringify(brand),
        });
        if (!result.success) throw Error("save failed");
        res.status(200).json({ brand });
      } catch {
        res
          .status(503)
          .json({
            error: "저장하지 못했습니다. 기존 설정은 그대로 유지됩니다.",
          });
      } finally {
        saving = false;
      }
    }
  );
}
module.exports = { schatBrandEndpoints };
