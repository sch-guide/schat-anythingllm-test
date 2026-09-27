import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function call(path, { method = "GET", body } = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: baseHeaders(),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.error)
      data.error =
        res.status === 401 || res.status === 403
          ? "권한이 없습니다."
          : "요청을 처리하지 못했습니다.";
    return { ok: res.ok, ...data };
  } catch {
    return { ok: false, error: "서버에 연결하지 못했습니다." };
  }
}

const query = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  ).toString();
  return search ? `?${search}` : "";
};

// 지침서 퀴즈. Staff calls only read stored questions and save answers; the
// only AI calls are the two admin generation requests at the bottom.
const SchatQuiz = {
  options: () => call("/schat/quiz/options"),
  start: (filters) =>
    call("/schat/quiz/attempts", { method: "POST", body: filters }),
  startWrongReview: (count) =>
    call("/schat/quiz/wrong-review", { method: "POST", body: { count } }),
  attempt: (id) => call(`/schat/quiz/attempts/${id}`),
  answer: (attemptId, questionId, answer) =>
    call(`/schat/quiz/attempts/${attemptId}/answers`, {
      method: "POST",
      body: { questionId, ...answer },
    }),
  history: () => call("/schat/quiz/history"),
  wrongNotes: () => call("/schat/quiz/wrong-notes"),
  removeWrongNote: (id) =>
    call(`/schat/quiz/wrong-notes/${id}`, { method: "DELETE" }),

  // ---- admin -----------------------------------------------------------------
  documents: () => call("/schat-admin/quiz/documents"),
  questions: (filters) => call(`/schat-admin/quiz/questions${query(filters)}`),
  question: (id) => call(`/schat-admin/quiz/questions/${id}`),
  updateQuestion: (id, changes) =>
    call(`/schat-admin/quiz/questions/${id}`, {
      method: "PATCH",
      body: changes,
    }),
  setStatus: (ids, status) =>
    call("/schat-admin/quiz/questions/status", {
      method: "POST",
      body: { ids, status },
    }),
  deleteQuestions: (ids, confirm) =>
    call("/schat-admin/quiz/questions/delete", {
      method: "POST",
      body: { ids, confirm },
    }),
  sets: () => call("/schat-admin/quiz/sets"),
  updateSet: (id, changes) =>
    call(`/schat-admin/quiz/sets/${id}`, { method: "PATCH", body: changes }),
  stats: () => call("/schat-admin/quiz/stats"),
  usage: () => call("/schat-admin/quiz/usage"),
  // AI (Gemini) - admin only
  generate: (input) =>
    call("/schat-admin/quiz/generate", { method: "POST", body: input }),
  regenerate: (id) =>
    call(`/schat-admin/quiz/questions/${id}/regenerate`, { method: "POST" }),
};

export default SchatQuiz;
