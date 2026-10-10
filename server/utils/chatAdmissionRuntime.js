const { createAdmission } = require("./chatAdmission");
const LABEL = "schat_chat_admission";
function validate(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16)
    throw Object.assign(new Error("SCHAT_INVALID_LIMIT"), {
      code: "SCHAT_INVALID_LIMIT",
    });
}
function createRuntime(storage) {
  const gate = createAdmission();
  let initialization;
  let writes = Promise.resolve();
  const ready = () => {
    if (!initialization)
      initialization = storage
        .read()
        .then((value) => {
          if (value !== null) {
            validate(value);
            gate.configure({ maxActive: value });
          }
          return gate;
        })
        .catch((error) => {
          initialization = null;
          throw error;
        });
    return initialization;
  };
  const save = async (value) => {
    validate(value);
    const job = writes.then(async () => {
      await ready();
      await storage.write(value);
      gate.configure({ maxActive: value });
      return gate.snapshot();
    });
    writes = job.catch(() => {});
    return job;
  };
  return { ready, save };
}
const runtime = createRuntime({
  read: async () => {
    const row = await require("./prisma").system_settings.findUnique({
      where: { label: LABEL },
    });
    return row ? JSON.parse(row.value).maxActive : null;
  },
  write: async (maxActive) => {
    const value = JSON.stringify({ maxActive });
    await require("./prisma").system_settings.upsert({
      where: { label: LABEL },
      create: { label: LABEL, value },
      update: { value, lastUpdatedAt: new Date() },
    });
  },
});
module.exports = { createRuntime, runtime };
