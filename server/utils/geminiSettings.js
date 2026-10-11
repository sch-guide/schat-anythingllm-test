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
module.exports = { readSetting, writeSetting, recordEvent };
