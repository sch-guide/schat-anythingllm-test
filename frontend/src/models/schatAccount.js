import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

async function call(path, { method = "GET", body, headers } = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: headers ?? baseHeaders(),
      ...(body !== undefined
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.error)
      data.error =
        res.status === 403 ? "권한이 없습니다." : "요청을 처리하지 못했습니다.";
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

// Employee accounts, reports and notifications. Passwords are only ever sent
// in request bodies and never kept in state after a request.
const SchatAccount = {
  loginOptions: () => call("/schat/login-options", { headers: {} }),
  employeeLogin: (form) =>
    call("/schat/employee-login", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/json" },
    }),
  firstLogin: (form) =>
    call("/schat/first-login", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/json" },
    }),
  firstLoginCheck: (form) =>
    call("/schat/first-login/check", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/json" },
    }),
  guide: (filters) => call(`/schat/guide${query(filters)}`),
  guideFeedback: (id, type) =>
    call(`/schat/guide/${id}/feedback`, { method: "POST", body: { type } }),
  me: () => call("/schat/me"),
  changePassword: (form) =>
    call("/schat/me/password", { method: "POST", body: form }),

  reportCategories: () => call("/schat/reports/categories"),
  createReport: (form) =>
    call("/schat/reports", { method: "POST", body: form }),
  myReports: () => call("/schat/reports/mine"),
  suggestFaqs: (q) => call(`/schat/faq/suggest${query({ q })}`),
  notifications: () => call("/schat/notifications"),
  markRead: (ids = null) =>
    call("/schat/notifications/read", { method: "POST", body: { ids } }),

  // admin
  accounts: (filters) => call(`/schat-admin/accounts${query(filters)}`),
  createAccount: (form) =>
    call("/schat-admin/accounts", { method: "POST", body: form }),
  updateAccount: (id, changes) =>
    call(`/schat-admin/accounts/${id}`, { method: "PATCH", body: changes }),
  resetPassword: (id) =>
    call(`/schat-admin/accounts/${id}/reset-password`, { method: "POST" }),
  deletePreview: (ids) =>
    call("/schat-admin/accounts/delete-preview", {
      method: "POST",
      body: { ids },
    }),
  deleteAccounts: (ids, confirm) =>
    call("/schat-admin/accounts/delete", {
      method: "POST",
      body: { ids, confirm },
    }),
  bulkStatus: (ids, active) =>
    call("/schat-admin/accounts/bulk-status", {
      method: "POST",
      body: { ids, active },
    }),
  departments: () => call("/schat-admin/departments"),
  createDepartment: (form) =>
    call("/schat-admin/departments", { method: "POST", body: form }),
  updateDepartment: (id, changes) =>
    call(`/schat-admin/departments/${id}`, { method: "PATCH", body: changes }),
  downloadTemplate: async () => {
    const res = await fetch(`${API_BASE}/schat-admin/accounts/bulk/template`, {
      headers: baseHeaders(),
    });
    if (!res.ok) return null;
    return res.blob();
  },
  bulkPreview: (file) => {
    const form = new FormData();
    form.append("file", file);
    const { "Content-Type": _drop, ...headers } = baseHeaders();
    return call("/schat-admin/accounts/bulk/preview", {
      method: "POST",
      body: form,
      headers,
    });
  },
  bulkCancel: (token) =>
    call("/schat-admin/accounts/bulk/cancel", {
      method: "POST",
      body: { token },
    }),
  bulkCommit: (token) =>
    call("/schat-admin/accounts/bulk/commit", {
      method: "POST",
      body: { token },
    }),

  reports: (filters) => call(`/schat-admin/reports${query(filters)}`),
  updateReport: (id, changes) =>
    call(`/schat-admin/reports/${id}`, { method: "PATCH", body: changes }),
  deleteReport: (id) =>
    call(`/schat-admin/reports/${id}`, { method: "DELETE" }),
  reportStats: () => call("/schat-admin/reports/stats"),
  faqs: () => call("/schat-admin/faq"),
  createFaq: (form) => call("/schat-admin/faq", { method: "POST", body: form }),
  updateFaq: (id, form) =>
    call(`/schat-admin/faq/${id}`, { method: "PATCH", body: form }),
  deleteFaq: (id) => call(`/schat-admin/faq/${id}`, { method: "DELETE" }),
};

export default SchatAccount;
