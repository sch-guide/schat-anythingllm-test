// Pure helpers for SCHAT employee accounts (no DB access here, so they can be
// unit tested). Accounts are identified by user id; the employee number is the
// unique login key. Names are only compared, never used to look anyone up.

const ROLE_LABELS = { default: "일반사용자", admin: "관리자" };
const ROLE_BY_LABEL = { 일반사용자: "default", 관리자: "admin" };
const LOGIN_FAILED_MESSAGE = "로그인 정보를 다시 확인해주세요.";
const PASSWORD_MIN_LENGTH = 8;

function normalizeText(value = "") {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Employee numbers are compared without any spaces ("10 001" -> "10001").
function normalizeEmployeeNumber(value = "") {
  return normalizeText(value).replace(/\s/g, "");
}

function internalUsername(employeeNumber) {
  // users.username must start with a lowercase letter.
  return `emp-${String(employeeNumber)
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, "-")}`;
}

function maskEmployeeNumber(value = "") {
  const text = String(value || "");
  if (text.length <= 2) return text ? `${text[0]}*` : "";
  return `${text.slice(0, 2)}${"*".repeat(Math.max(1, text.length - 3))}${text.slice(-1)}`;
}

function validateNewPassword(password = "", { employeeNumber } = {}) {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN_LENGTH)
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  if (value.length > 128) return "비밀번호가 너무 깁니다.";
  const kinds = [/[a-zA-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(value)
  ).length;
  if (kinds < 2) return "영문, 숫자, 특수문자 중 두 가지 이상을 섞어 주세요.";
  if (employeeNumber && value.includes(String(employeeNumber)))
    return "사번이 들어간 비밀번호는 사용할 수 없습니다.";
  return null;
}

// Department + employee number + name all match an active account.
function identityMatches(input = {}, user = null) {
  const employeeNumber = normalizeEmployeeNumber(input.employeeNumber);
  if (!user || !employeeNumber || user.suspended) return false;
  return (
    normalizeEmployeeNumber(user.employee_number) === employeeNumber &&
    normalizeText(user.department?.name) === normalizeText(input.department) &&
    normalizeText(user.display_name) === normalizeText(input.name)
  );
}

/**
 * Employee login decision. Every failure returns the same generic message so
 * the caller cannot tell which field was wrong. An account whose password has
 * not been set yet (new or reset by an admin) never accepts a password; when
 * its department/number/name match, the caller sends the employee to the
 * first-login screen instead.
 * @param {object} input {department, employeeNumber, name, password}
 * @param {object} user users row incl. password hash and department relation
 * @param {(plain: string, hash: string) => boolean} compare bcrypt compare
 */
function checkEmployeeLogin(input = {}, user = null, compare) {
  const fail = { ok: false, message: LOGIN_FAILED_MESSAGE };
  const password = String(input.password ?? "");
  // The caller's compare() checks against a dummy hash when there is no user,
  // so timing does not reveal whether the employee number exists.
  const passwordOk = password
    ? compare(password, user?.password || null)
    : false;
  if (!identityMatches(input, user)) return fail;
  if (user.must_change_password) return { ok: false, firstLoginRequired: true };
  if (!passwordOk) return fail;
  return { ok: true };
}

// First-login password setup is only possible while no password is set.
function checkFirstLogin(input = {}, user = null) {
  const identity = checkFirstLoginIdentity(input, user);
  if (!identity.ok) return identity;
  const problem = validateNewPassword(input.newPassword, {
    employeeNumber: user.employee_number,
  });
  if (problem) return { ok: false, message: problem, fieldError: true };
  if (String(input.newPassword) !== String(input.confirmPassword ?? ""))
    return {
      ok: false,
      message: "새 비밀번호가 서로 다릅니다.",
      fieldError: true,
    };
  return { ok: true };
}

const ALREADY_SET_MESSAGE =
  "이미 비밀번호가 설정된 계정입니다. 기존 비밀번호로 로그인해주세요.";

// Step 1 of "비밀번호 만들기": is this a registered, active employee without a
// password yet? Unknown or mismatched details get the generic message only.
function checkFirstLoginIdentity(input = {}, user = null) {
  if (!identityMatches(input, user))
    return { ok: false, message: LOGIN_FAILED_MESSAGE };
  if (!user.must_change_password)
    return { ok: false, alreadySet: true, message: ALREADY_SET_MESSAGE };
  return { ok: true };
}

/**
 * Basic brute-force guard: after `max` failures for a key within `windowMs`,
 * that key is blocked until the window passes. Keys are IPs and employee
 * numbers; nothing else is kept.
 */
function createAttemptLimiter({
  max = 10,
  windowMs = 10 * 60 * 1000,
  now = Date.now,
} = {}) {
  const failures = new Map(); // key -> [timestamps]
  const recent = (key) => {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) || []).filter((t) => t > cutoff);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  return {
    blocked: (keys) =>
      keys.filter(Boolean).some((k) => recent(k).length >= max),
    fail: (keys) => {
      for (const k of keys.filter(Boolean))
        failures.set(k, [...recent(k), now()]);
    },
    reset: (keys) => keys.filter(Boolean).forEach((k) => failures.delete(k)),
  };
}

// ---- bulk registration -----------------------------------------------------

const TEMPLATE_HEADERS = ["부서", "사번", "이름", "권한"];
const HEADER_ALIASES = {
  department: ["부서", "부서명", "department"],
  employeeNumber: ["사번", "직원번호", "employee number", "employeenumber"],
  name: ["이름", "성명", "name"],
  role: ["권한", "role"],
};

function mapHeader(headerRow = []) {
  const index = {};
  headerRow.forEach((cell, i) => {
    const key = normalizeText(cell).toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES))
      if (aliases.includes(key) && index[field] === undefined) index[field] = i;
  });
  return index;
}

/**
 * Validates parsed rows for NEW registrations only. Existing employee numbers
 * are reported as "이미 등록됨" and never overwritten.
 * @param {Array<Array<any>>} table first row = header, rows as arrays
 * @param {{departments: Array<{id,name,active}>, existing: Map<string,{name, department}>}} ctx
 */
function validateBulkRows(
  table = [],
  { departments = [], existing = new Map() } = {}
) {
  const header = mapHeader(table[0] || []);
  const missing = ["department", "employeeNumber", "name"].filter(
    (field) => header[field] === undefined
  );
  if (missing.length)
    return {
      fatal:
        "필수 칸(부서, 사번, 이름)이 없습니다. 일괄등록 양식을 사용해 주세요.",
      total: 0,
      valid: [],
      errors: [],
    };

  const activeDepartments = new Map(
    departments.filter((d) => d.active).map((d) => [normalizeText(d.name), d])
  );
  const rows = [];
  table.slice(1).forEach((cells, i) => {
    const get = (field) =>
      header[field] === undefined ? "" : cells?.[header[field]];
    const row = {
      line: i + 2,
      department: normalizeText(get("department")),
      employeeNumber: normalizeEmployeeNumber(get("employeeNumber")),
      name: normalizeText(get("name")),
      roleLabel: normalizeText(get("role")) || "일반사용자",
    };
    if (
      !row.department &&
      !row.employeeNumber &&
      !row.name &&
      !normalizeText(get("role"))
    )
      return; // blank row
    rows.push(row);
  });

  const seen = new Map();
  for (const row of rows) {
    if (!row.employeeNumber) continue;
    if (!seen.has(row.employeeNumber)) seen.set(row.employeeNumber, []);
    seen.get(row.employeeNumber).push(row);
  }

  const valid = [];
  const errors = [];
  for (const row of rows) {
    const problems = [];
    if (!row.department) problems.push("부서가 비어 있습니다.");
    else if (!activeDepartments.has(row.department))
      problems.push("등록되지 않았거나 사용중지된 부서입니다.");
    if (!row.employeeNumber) problems.push("사번이 비어 있습니다.");
    else if (!/^[A-Za-z0-9-]{1,30}$/.test(row.employeeNumber))
      problems.push("사번에는 영문, 숫자, 하이픈만 쓸 수 있습니다.");
    if (!row.name) problems.push("이름이 없습니다.");
    else if (row.name.length > 50) problems.push("이름이 너무 깁니다.");
    const role = ROLE_BY_LABEL[row.roleLabel];
    if (!role)
      problems.push("권한은 '일반사용자' 또는 '관리자'만 쓸 수 있습니다.");

    let status = null;
    const sameInFile = seen.get(row.employeeNumber) || [];
    if (row.employeeNumber && sameInFile.length > 1) {
      const differs = sameInFile.some(
        (other) =>
          other.name !== row.name || other.department !== row.department
      );
      problems.push(
        differs
          ? "같은 사번에 이름 또는 부서가 다른 행이 있습니다."
          : "파일 안에 같은 사번이 여러 번 있습니다."
      );
    }
    const current = row.employeeNumber
      ? existing.get(row.employeeNumber)
      : null;
    if (current) {
      status = "이미 등록됨";
      if (current.name !== row.name || current.department !== row.department)
        problems.push(
          "이미 등록된 사번입니다(기존 이름 또는 부서가 다릅니다)."
        );
      else problems.push("이미 등록된 사번입니다.");
    }

    if (problems.length)
      errors.push({
        line: row.line,
        employeeNumber: row.employeeNumber || null,
        name: row.name || null,
        department: row.department || null,
        status: status || "오류",
        reasons: problems,
      });
    else
      valid.push({
        line: row.line,
        department: row.department,
        departmentId: activeDepartments.get(row.department).id,
        employeeNumber: row.employeeNumber,
        name: row.name,
        role,
      });
  }
  return { fatal: null, total: rows.length, valid, errors };
}

// Minimal RFC 4180 CSV reader (quotes, escaped quotes, CRLF, BOM).
function parseCsv(text = "") {
  const input = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---- FAQ suggestion (keyword based, no AI call) -----------------------------

function tokens(text = "") {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/)
    .filter((t) => t.length >= 2);
}

function suggestFaqs(query = "", faqs = [], limit = 3) {
  const words = new Set(tokens(query));
  if (!words.size) return [];
  return faqs
    .filter((faq) => faq.active)
    .map((faq) => {
      const keywords = String(faq.keywords || "")
        .split(/[,\n]/)
        .map((k) => normalizeText(k).toLowerCase())
        .filter(Boolean);
      const haystack = tokens(`${faq.title} ${faq.problem || ""}`);
      let score = 0;
      for (const keyword of keywords)
        if ([...words].some((w) => w.includes(keyword) || keyword.includes(w)))
          score += 3;
      for (const word of haystack) if (words.has(word)) score += 1;
      return { faq, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.faq);
}

// 이용 가이드 search over active items only: title, problem, keywords and
// solution. Every word typed must appear somewhere (local, no AI call).
function searchGuide(faqs = [], { q = "", category = "" } = {}) {
  const words = normalizeText(q).toLowerCase().split(" ").filter(Boolean);
  return faqs
    .filter((faq) => faq.active)
    .filter((faq) => !category || faq.category === category)
    .filter((faq) => {
      if (!words.length) return true;
      const haystack = normalizeText(
        [faq.title, faq.problem, faq.keywords, faq.solution].join(" ")
      ).toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
}

// ---- report status & statistics -------------------------------------------

const REPORT_STATUS = {
  open: "미처리",
  in_progress: "처리중",
  resolved: "완료",
};
const STATUS_NOTIFICATIONS = {
  in_progress: "신고하신 문제를 관리자가 확인하고 있습니다.",
  resolved: "문제 신고가 처리되었습니다.",
};

function reportStatistics(reports = [], now = new Date()) {
  const day = 24 * 60 * 60 * 1000;
  const byStatus = { open: 0, in_progress: 0, resolved: 0 };
  const byCategory = {};
  const byDepartment = {};
  let recent7 = 0;
  let recent30 = 0;
  let resolvedMs = 0;
  let resolvedCount = 0;
  for (const report of reports) {
    byStatus[report.status] = (byStatus[report.status] || 0) + 1;
    byCategory[report.category] = (byCategory[report.category] || 0) + 1;
    const dept = report.department_name || "부서 없음";
    byDepartment[dept] = (byDepartment[dept] || 0) + 1;
    const age = now - new Date(report.createdAt);
    if (age <= 7 * day) recent7 += 1;
    if (age <= 30 * day) recent30 += 1;
    if (report.status === "resolved" && report.resolved_at) {
      resolvedMs += new Date(report.resolved_at) - new Date(report.createdAt);
      resolvedCount += 1;
    }
  }
  return {
    total: reports.length,
    byStatus,
    recent7,
    recent30,
    averageResolutionHours: resolvedCount
      ? Math.round((resolvedMs / resolvedCount / 3600000) * 10) / 10
      : null,
    byCategory,
    byDepartment,
  };
}

module.exports = {
  ROLE_LABELS,
  ROLE_BY_LABEL,
  LOGIN_FAILED_MESSAGE,
  TEMPLATE_HEADERS,
  REPORT_STATUS,
  STATUS_NOTIFICATIONS,
  normalizeText,
  normalizeEmployeeNumber,
  internalUsername,
  maskEmployeeNumber,
  validateNewPassword,
  checkEmployeeLogin,
  checkFirstLogin,
  checkFirstLoginIdentity,
  createAttemptLimiter,
  searchGuide,
  ALREADY_SET_MESSAGE,
  identityMatches,
  validateBulkRows,
  parseCsv,
  suggestFaqs,
  reportStatistics,
};
