// Private settings: never added to publicFields or generic public APIs.
async function readSetting(label) {
  const row = await require("./prisma").system_settings.findUnique({
    where: { label },
  });
  return row?.value ? JSON.parse(row.value) : null;
}
async function writeSetting(label, value) {
  await require("./prisma").system_settings.upsert({
    where: { label },
    create: { label, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value), lastUpdatedAt: new Date() },
  });
}
async function recordEvent(name, data) {
  const { EventLogs } = require("../models/eventLogs");
  await EventLogs.logEvent(name, { kind: data.kind });
}
// Compare the exact persisted JSON in the UPDATE predicate. This is atomic
// across processes too; a concurrent writer must refresh its revision.
async function compareAndSwapSetting(label, revision, value) {
  const table = require("./prisma").system_settings;
  const row = await table.findUnique({ where: { label } });
  if (!row) {
    if (revision !== 0) return false;
    try {
      await table.create({ data: { label, value: JSON.stringify(value) } });
      return true;
    } catch (error) {
      if (error.code === "P2002") return false;
      throw error;
    }
  }
  if (JSON.parse(row.value).revision !== revision) return false;
  const changed = await table.updateMany({
    where: { label, value: row.value },
    data: { value: JSON.stringify(value), lastUpdatedAt: new Date() },
  });
  return changed.count === 1;
}
module.exports = {
  readSetting,
  writeSetting,
  recordEvent,
  compareAndSwapSetting,
};
