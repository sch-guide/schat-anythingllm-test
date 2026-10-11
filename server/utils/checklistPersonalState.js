const { randomUUID } = require("node:crypto");
const TTL = 24 * 60 * 60 * 1000;
function fault(code) {
  return Object.assign(new Error(code), { code });
}
function identity(userId, checklistId) {
  if (
    !Number.isSafeInteger(userId) ||
    userId < 1 ||
    typeof checklistId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(checklistId)
  )
    throw fault("INVALID_STATE");
}
function validated(input) {
  if (
    !input ||
    typeof input !== "object" ||
    !(
      input.revision === null ||
      (typeof input.revision === "string" && input.revision.length <= 64)
    ) ||
    typeof input.patient !== "string" ||
    input.patient.length > 500 ||
    typeof input.other !== "string" ||
    input.other.length > 10000 ||
    !input.checks ||
    typeof input.checks !== "object" ||
    Array.isArray(input.checks)
  )
    throw fault("INVALID_STATE");
  const entries = Object.entries(input.checks);
  if (
    entries.length > 1000 ||
    entries.some(
      ([key, value]) => key.length > 250 || typeof value !== "boolean"
    )
  )
    throw fault("INVALID_STATE");
  return JSON.stringify({
    checks: Object.fromEntries(entries.filter(([, v]) => v)),
    patient: input.patient,
    other: input.other,
  });
}
function unpack(row) {
  return row
    ? {
        ...JSON.parse(row.payload),
        revision: row.revision,
        updatedAt: Number(row.updatedAt),
        expiresAt: Number(row.expiresAt),
      }
    : null;
}
// Only use a dedicated Prisma client with logging disabled. Never log thrown
// DB errors: driver errors can contain SQL parameters (private free text).
function createPersonalStateStore(db, clock = Date.now) {
  return {
    async read(userId, checklistId) {
      identity(userId, checklistId);
      const rows = await db.$queryRawUnsafe(
        "SELECT payload, revision, updatedAt, expiresAt FROM schat_checklist_personal_state WHERE userId=? AND checklistId=? AND expiresAt>?",
        userId,
        checklistId,
        clock()
      );
      return unpack(rows[0]);
    },
    async save(userId, checklistId, input) {
      identity(userId, checklistId);
      const payload = validated(input);
      const now = clock();
      const rows = await db.$queryRawUnsafe(
        `
        INSERT INTO schat_checklist_personal_state
          (userId, checklistId, revision, payload, updatedAt, expiresAt)
        SELECT ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (
          SELECT 1 FROM schat_checklist_personal_state
          WHERE userId=? AND checklistId=? AND revision=? AND expiresAt>?)
        ON CONFLICT(userId, checklistId) DO UPDATE SET
          revision=excluded.revision, payload=excluded.payload,
          updatedAt=CASE WHEN schat_checklist_personal_state.payload=excluded.payload AND schat_checklist_personal_state.expiresAt>? THEN schat_checklist_personal_state.updatedAt ELSE excluded.updatedAt END,
          expiresAt=CASE WHEN schat_checklist_personal_state.payload=excluded.payload AND schat_checklist_personal_state.expiresAt>? THEN schat_checklist_personal_state.expiresAt ELSE excluded.expiresAt END
        WHERE (schat_checklist_personal_state.expiresAt<=? AND ? IS NULL)
           OR (schat_checklist_personal_state.expiresAt>? AND schat_checklist_personal_state.revision=?)
        RETURNING payload, revision, updatedAt, expiresAt`,
        userId,
        checklistId,
        randomUUID(),
        payload,
        now,
        now + TTL,
        input.revision,
        userId,
        checklistId,
        input.revision,
        now,
        now,
        now,
        now,
        input.revision,
        now,
        input.revision
      );
      if (!rows.length) throw fault("CONFLICT");
      return unpack(rows[0]);
    },
    async cleanup() {
      return db.$executeRawUnsafe(
        "DELETE FROM schat_checklist_personal_state WHERE expiresAt<=?",
        clock()
      );
    },
  };
}
module.exports = { createPersonalStateStore };
