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
      /(?<![가-힣])([가-힣]{2,4})(\s*(?:님|환자|씨))(?=(?:께서|에게|으로|은|는|이|가|을|를|의|께|도|만|과|와|로)*(?:$|[^가-힣]))/gu,
      (_, name, suffix) => hide(name) + suffix
    )
    .replace(
      /(?<![가-힣○])((?:환자|성명|이름)\s*[:：]?\s*)([가-힣]{2,4}?)(?=(?:께서|에게|으로|은|는|이|가|을|를|의|께|도|만|과|와|로)*(?:$|[^가-힣]))/gu,
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
const FEEDBACK_NOTIFICATION_KIND = "feedback_resolved";
const FEEDBACK_DEFAULT_RESOLUTION = "보내 주신 의견을 확인하고 답변을 수정했습니다.";
const FEEDBACK_REASON_LABELS = { wrong: "틀린 내용", not_found: "원하는 내용을 못 찾음" };

/**
 * 알림함에 보일 모양. 문제신고 알림과 같은 칸(report.title·statusLabel·resolution)을 써서
 * 직원 화면(알림 종)은 그대로 둔다. 질문은 직원 본인의 질문이다.
 */
function presentFeedbackNotification(row = {}) {
  let data = {};
  try {
    data = JSON.parse(row.message || "{}") || {};
  } catch {}
  const label = FEEDBACK_REASON_LABELS[data.reason] || "답변 평가";
  return {
    message: `보내 주신 답변 의견(${label})을 처리했습니다.`,
    report: {
      id: null,
      title: String(data.question || "질문"),
      statusLabel: "처리 완료",
      resolution: String(data.resolution || FEEDBACK_DEFAULT_RESOLUTION),
      resolvedAt: row.createdAt,
    },
  };
}

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
    // 처리 완료. 처음 완료할 때 👎를 보낸 직원에게 알림을 보낸다(2026-11-09, 문제신고와 같은 알림함).
    // resolution: 관리자가 적은 처리 결과(선택, 1000자). 비우면 기본 문장.
    async resolve(id, { resolution } = {}) {
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1)
        throw fault("NOT_FOUND");
      const text =
        String(resolution ?? "").trim().slice(0, 1000) ||
        FEEDBACK_DEFAULT_RESOLUTION;
      await db.$transaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe(
          `SELECT f.id, f.userId, f.status, f.reason, c.prompt AS question
          FROM schat_answer_feedback f JOIN workspace_chats c ON c.id=f.chatId
          WHERE f.id=? AND f.feedback=0`,
          Number(id)
        );
        if (!rows.length) throw fault("NOT_FOUND");
        const now = clock();
        await tx.$executeRawUnsafe(
          "UPDATE schat_answer_feedback SET status='resolved',resolvedAt=?,updatedAt=? WHERE id=? AND feedback=0",
          now,
          now,
          Number(id)
        );
        if (rows[0].status === "resolved") return;
        await tx.$executeRawUnsafe(
          "INSERT INTO schat_user_notifications (user_id,report_id,kind,message,read_at,createdAt) VALUES (?,NULL,?,?,NULL,?)",
          Number(rows[0].userId),
          FEEDBACK_NOTIFICATION_KIND,
          JSON.stringify({
            reason: rows[0].reason,
            question: String(rows[0].question || "").slice(0, 200),
            resolution: text,
          }),
          now
        );
      });
      return this.detail(id);
    },
    // 처리 완료된 👎 평가만 지움. 직원 계정·채팅 기록은 그대로 둠.
    async remove(id) {
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1)
        throw fault("NOT_FOUND");
      const rows = await db.$queryRawUnsafe(
        "SELECT id, reason, status FROM schat_answer_feedback WHERE id=? AND feedback=0",
        Number(id)
      );
      if (!rows.length) throw fault("NOT_FOUND");
      if (rows[0].status !== "resolved") throw fault("NOT_RESOLVED");
      const count = await db.$executeRawUnsafe(
        "DELETE FROM schat_answer_feedback WHERE id=? AND feedback=0 AND status='resolved'",
        Number(id)
      );
      if (!count) throw fault("NOT_RESOLVED");
      return { id: Number(id), kind: rows[0].reason };
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
module.exports = {
  createAnswerFeedbackStore,
  answerFeedbackStore,
  maskMemo,
  FEEDBACK_NOTIFICATION_KIND,
  presentFeedbackNotification,
};
