function fault(code) {
  return Object.assign(new Error(code), { code });
}
function maskMemo(value) {
  const hide = (name) =>
    name[0] +
    "○".repeat(name.length - 2 || 1) +
    (name.length > 2 ? name.at(-1) : "");
  return value
    .replace(
      /(?<![가-힣])([가-힣]{2,4})(\s*(?:님|환자|씨))(?=(?:은|는|이|가|을|를|의|께서|에게|께|도|만|과|와|으로|로)?(?:$|[^가-힣]))/gu,
      (_, name, suffix) => hide(name) + suffix
    )
    .replace(
      /((?:환자|성명|이름)\s*[:：]?\s*)([가-힣]{2,4}?)(?=(?:은|는|이|가|을|를|의|께서|에게|께|도|만|과|와|으로|로)?(?:$|[^가-힣]))/gu,
      (_, prefix, name) => prefix + hide(name)
    )
    .replace(
      /\d{8,}/g,
      (digits) => digits.slice(0, 4) + "*".repeat(digits.length - 4)
    );
}
function validate(input) {
  if (!input || ![true, false, null].includes(input.feedback))
    throw fault("INVALID_FEEDBACK");
  if (input.feedback !== false)
    return { feedback: input.feedback, reason: null, memo: null };
  if (
    !["wrong", "not_found"].includes(input.reason) ||
    (input.memo !== undefined && typeof input.memo !== "string") ||
    (input.memo?.length || 0) > 200 ||
    /[\r\n]/.test(input.memo || "")
  )
    throw fault("INVALID_FEEDBACK");
  return {
    feedback: false,
    reason: input.reason,
    memo: maskMemo((input.memo || "").trim()) || null,
  };
}
const joined = `SELECT f.*, c.prompt AS question, c.response, d.name AS department
  FROM schat_answer_feedback f JOIN workspace_chats c ON c.id=f.chatId AND c.user_id=f.userId
  LEFT JOIN users u ON u.id=f.userId LEFT JOIN schat_departments d ON d.id=u.department_id
  WHERE f.feedback=0`;
function present(row, full = false) {
  if (!row) return null;
  let response = {};
  if (full) {
    try {
      response = JSON.parse(row.response);
    } catch {}
  }
  return {
    id: Number(row.id),
    kind: row.reason,
    chatId: Number(row.chatId),
    question: row.question,
    memo: row.memo,
    department: row.department || "",
    status: row.status,
    createdAt: new Date(Number(row.createdAt)).toISOString(),
    updatedAt: new Date(Number(row.updatedAt)).toISOString(),
    resolvedAt:
      row.resolvedAt == null
        ? null
        : new Date(Number(row.resolvedAt)).toISOString(),
    ...(full
      ? {
          answer: response.text || "",
          sources: Array.isArray(response.sources) ? response.sources : [],
        }
      : {}),
  };
}
// The caller must supply a dedicated Prisma client with logging disabled.
// Do not log raw driver exceptions; they can contain private free text.
function createAnswerFeedbackStore(db, clock = Date.now) {
  return {
    async save(userId, workspaceId, chatId, input) {
      if (
        ![userId, workspaceId, chatId].every(
          (v) => Number.isSafeInteger(v) && v > 0
        )
      )
        throw fault("NOT_FOUND");
      const value = validate(input);
      return db.$transaction(async (tx) => {
        const owned = await tx.$queryRawUnsafe(
          "SELECT id FROM workspace_chats WHERE id=? AND workspaceId=? AND user_id=?",
          chatId,
          workspaceId,
          userId
        );
        if (!owned.length) throw fault("NOT_FOUND");
        if (value.feedback === null) {
          await tx.$executeRawUnsafe(
            "DELETE FROM schat_answer_feedback WHERE userId=? AND chatId=?",
            userId,
            chatId
          );
        } else {
          const now = clock();
          await tx.$executeRawUnsafe(
            `INSERT INTO schat_answer_feedback (chatId,userId,feedback,reason,memo,status,createdAt,updatedAt,resolvedAt)
            VALUES (?,?,?,?,?,'open',?,?,NULL) ON CONFLICT(userId,chatId) DO UPDATE SET
            feedback=excluded.feedback,reason=excluded.reason,memo=excluded.memo,status='open',updatedAt=excluded.updatedAt,resolvedAt=NULL`,
            chatId,
            userId,
            value.feedback ? 1 : 0,
            value.reason,
            value.memo,
            now,
            now
          );
        }
        await tx.$executeRawUnsafe(
          "UPDATE workspace_chats SET feedbackScore=? WHERE id=? AND workspaceId=? AND user_id=?",
          value.feedback === null ? null : value.feedback ? 1 : 0,
          chatId,
          workspaceId,
          userId
        );
        return { ...value, chatId };
      });
    },
    async list(filters = {}) {
      if (filters.kind === "report" || filters.category) return [];
      const rows = await db.$queryRawUnsafe(
        joined + " ORDER BY f.createdAt DESC, f.id DESC"
      );
      return rows
        .map((row) => present(row))
        .filter(
          (row) =>
            (!filters.kind || row.kind === filters.kind) &&
            (!filters.status || row.status === filters.status) &&
            (!filters.department || row.department === filters.department) &&
            (!filters.q ||
              `${row.question} ${row.memo || ""}`
                .toLowerCase()
                .includes(String(filters.q).toLowerCase())) &&
            (!filters.from || require("./aiUsageFees").kstDay(row.createdAt) >= filters.from) &&
            (!filters.to || require("./aiUsageFees").kstDay(row.createdAt) <= filters.to)
        );
    },
    async detail(id) {
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1)
        throw fault("NOT_FOUND");
      const rows = await db.$queryRawUnsafe(joined + " AND f.id=?", Number(id));
      if (!rows.length) throw fault("NOT_FOUND");
      return present(rows[0], true);
    },
    async resolve(id) {
      const count = await db.$executeRawUnsafe(
        "UPDATE schat_answer_feedback SET status='resolved',resolvedAt=?,updatedAt=? WHERE id=? AND feedback=0",
        clock(),
        clock(),
        Number(id)
      );
      if (!count) throw fault("NOT_FOUND");
      return this.detail(id);
    },
  };
}
let privateStore;
function answerFeedbackStore() {
  if (!privateStore) {
    const { PrismaClient } = require("@prisma/client");
    privateStore = createAnswerFeedbackStore(
      new PrismaClient({ log: [], errorFormat: "minimal" })
    );
  }
  return privateStore;
}
module.exports = { createAnswerFeedbackStore, answerFeedbackStore, maskMemo };
