// Database side of SCHAT employee accounts, issue reports and notifications.
// Reuses the existing users table, bcrypt hashing and JWT sessions.
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../prisma");
const core = require("./core");

let dummyHash = null;
function comparePassword(plain, hash) {
  if (!dummyHash)
    dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 10);
  try {
    return bcrypt.compareSync(String(plain), hash || dummyHash) && !!hash;
  } catch {
    return false;
  }
}
const hashPassword = (plain) => bcrypt.hashSync(String(plain), 10);
// "No password yet": a hash of a random secret nobody knows. Together with
// must_change_password it keeps the account closed until the employee sets
// their own password on the first-login screen.
const unsetPasswordHash = () =>
  hashPassword(crypto.randomBytes(32).toString("hex"));

const USER_INCLUDE = { department: true };

function roleLabel(role) {
  return core.ROLE_LABELS[role] || (role === "manager" ? "매니저" : role);
}

// What the browser may know about an account. Never includes the hash.
function presentUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.display_name || user.username,
    employeeNumber: user.employee_number || null,
    employeeNumberMasked: core.maskEmployeeNumber(user.employee_number),
    department: user.department?.name || null,
    departmentId: user.department_id || null,
    role: user.role,
    roleLabel: roleLabel(user.role),
    active: !user.suspended,
    mustChangePassword: !!user.must_change_password,
    lastLoginAt: user.last_login_at || null,
    createdAt: user.createdAt,
    isEmployeeAccount: !!user.employee_number,
  };
}

// ---- departments -----------------------------------------------------------

async function listDepartments({ activeOnly = false } = {}) {
  const departments = await prisma.schat_departments.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  });
  return departments.map((d) => ({
    id: d.id,
    name: d.name,
    active: d.active,
    sortOrder: d.sort_order,
    userCount: d._count.users,
  }));
}

async function saveDepartment({ id = null, name, active, sortOrder }) {
  const clean = core.normalizeText(name);
  if (id === null && !clean) throw userError("부서 이름을 입력해 주세요.");
  if (clean && clean.length > 50) throw userError("부서 이름이 너무 깁니다.");
  const data = {
    ...(clean ? { name: clean } : {}),
    ...(typeof active === "boolean" ? { active } : {}),
    ...(Number.isInteger(sortOrder) ? { sort_order: sortOrder } : {}),
    lastUpdatedAt: new Date(),
  };
  try {
    return id === null
      ? await prisma.schat_departments.create({ data })
      : await prisma.schat_departments.update({
          where: { id: Number(id) },
          data,
        });
  } catch (error) {
    if (error?.code === "P2002")
      throw userError("같은 이름의 부서가 이미 있습니다.");
    throw error;
  }
}

/**
 * Deletes a department that has no accounts (e.g. a test department).
 * The "no accounts" condition is part of the delete statement itself, so an
 * account added in the meantime still blocks the deletion. Accounts, reports
 * (they keep their own department name) and other departments are untouched.
 */
async function deleteDepartment(adminId, id, { db = prisma, log } = {}) {
  const departmentId = Number(id);
  if (!Number.isInteger(departmentId) || departmentId <= 0)
    throw userError("부서를 찾을 수 없습니다.");
  const department = await db.schat_departments.findUnique({
    where: { id: departmentId },
    include: { _count: { select: { users: true } } },
  });
  if (!department) throw userError("부서를 찾을 수 없습니다.");
  if (department._count.users > 0)
    throw userError(
      `직원 ${department._count.users}명이 소속된 부서는 삭제할 수 없습니다. 사용중지를 이용해 주세요.`
    );
  const { count } = await db.schat_departments.deleteMany({
    where: { id: departmentId, users: { none: {} } },
  });
  if (count !== 1)
    throw userError(
      "직원이 소속되어 있어 삭제하지 않았습니다. 목록을 새로 고친 뒤 확인해 주세요."
    );
  const logEvent =
    log ||
    ((...args) =>
      require("../../models/eventLogs").EventLogs.logEvent(...args));
  await Promise.resolve(
    logEvent(
      "schat_department_deleted",
      { departmentId, name: department.name },
      adminId
    )
  ).catch(() => null);
  return { id: departmentId, name: department.name };
}

// ---- accounts ----------------------------------------------------------------

function userError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}

async function legacyLoginAvailable() {
  const count = await prisma.users.count({
    where: { employee_number: null, suspended: 0 },
  });
  return count > 0;
}

async function findEmployee(employeeNumber) {
  const number = core.normalizeEmployeeNumber(employeeNumber);
  return number
    ? prisma.users.findUnique({
        where: { employee_number: number },
        include: USER_INCLUDE,
      })
    : null;
}

async function employeeLogin(input) {
  const user = await findEmployee(input?.employeeNumber);
  const result = core.checkEmployeeLogin(input, user, comparePassword);
  if (result.firstLoginRequired)
    return { user: null, firstLoginRequired: true };
  if (!result.ok) return { user: null, message: result.message };
  const updated = await prisma.users.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
    include: USER_INCLUDE,
  });
  return { user: updated, message: null };
}

async function firstLoginCheck(input) {
  const user = await findEmployee(input?.employeeNumber);
  return core.checkFirstLoginIdentity(input, user);
}

// 처음 로그인: the employee sets their own password. Only possible while the
// account has no password (new, or reset by an admin).
async function firstLogin(input) {
  const user = await findEmployee(input?.employeeNumber);
  const check = core.checkFirstLogin(input, user);
  if (!check.ok) return { user: null, message: check.message };
  const now = new Date();
  // Conditional update: a second request racing this one finds no row with
  // must_change_password=true and fails instead of overwriting.
  const { count } = await prisma.users.updateMany({
    where: { id: user.id, must_change_password: true, suspended: 0 },
    data: {
      password: hashPassword(input.newPassword),
      must_change_password: false,
      password_changed_at: now,
      last_login_at: now,
      lastUpdatedAt: now,
    },
  });
  if (count !== 1) return { user: null, message: core.LOGIN_FAILED_MESSAGE };
  return { user: await getAccount(user.id), message: null };
}

async function getAccount(id) {
  return prisma.users.findUnique({
    where: { id: Number(id) },
    include: USER_INCLUDE,
  });
}

async function listAccounts({ q = "", departmentId, role, status } = {}) {
  const query = core.normalizeText(q);
  const users = await prisma.users.findMany({
    where: {
      ...(departmentId ? { department_id: Number(departmentId) } : {}),
      ...(role ? { role } : {}),
      ...(status === "active" ? { suspended: 0 } : {}),
      ...(status === "inactive" ? { suspended: { not: 0 } } : {}),
      ...(query
        ? {
            OR: [
              { display_name: { contains: query } },
              { employee_number: { contains: query.replace(/\s/g, "") } },
              { username: { contains: query } },
            ],
          }
        : {}),
    },
    include: USER_INCLUDE,
    orderBy: [{ createdAt: "asc" }],
  });
  return users.map(presentUser);
}

async function existingEmployees() {
  const rows = await prisma.users.findMany({
    where: { employee_number: { not: null } },
    select: {
      employee_number: true,
      display_name: true,
      department: { select: { name: true } },
    },
  });
  return new Map(
    rows.map((r) => [
      r.employee_number,
      { name: r.display_name || "", department: r.department?.name || "" },
    ])
  );
}

// New staff can use every workspace (SCHAT runs a single hospital workspace).
async function grantAllWorkspaces(tx, userIds) {
  const workspaces = await tx.workspaces.findMany({ select: { id: true } });
  const rows = [];
  for (const user_id of userIds)
    for (const { id: workspace_id } of workspaces)
      rows.push({ user_id, workspace_id });
  for (const row of rows) await tx.workspace_users.create({ data: row });
}

function newAccountData({ employeeNumber, name, departmentId, role, active }) {
  return {
    username: core.internalUsername(employeeNumber),
    password: unsetPasswordHash(),
    role,
    suspended: active === false ? 1 : 0,
    disabled_at: active === false ? new Date() : null,
    employee_number: employeeNumber,
    display_name: name,
    department_id: departmentId,
    must_change_password: true, // employee sets the password at first login
    seen_recovery_codes: true, // admins reset forgotten passwords instead
  };
}

async function validateSingle({ name, employeeNumber, departmentId, role }) {
  const dept = departmentId
    ? await prisma.schat_departments.findUnique({
        where: { id: Number(departmentId) },
      })
    : null;
  const table = [
    core.TEMPLATE_HEADERS,
    [
      dept?.name || "",
      employeeNumber,
      name,
      core.ROLE_LABELS[role] || String(role || ""),
    ],
  ];
  const result = core.validateBulkRows(table, {
    departments: await listDepartments(),
    existing: await existingEmployees(),
  });
  if (result.errors.length) throw userError(result.errors[0].reasons.join(" "));
  return result.valid[0];
}

async function createAccount(input) {
  const row = await validateSingle(input);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.users.create({
      data: newAccountData({ ...row, active: input.active !== false }),
    });
    await grantAllWorkspaces(tx, [created.id]);
    return created;
  });
  return { user: presentUser(await getAccount(user.id)) };
}

async function countActiveAdmins(excludeId = null) {
  return prisma.users.count({
    where: {
      role: "admin",
      suspended: 0,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

async function updateAccount(actor, id, changes = {}) {
  const user = await getAccount(id);
  if (!user) throw userError("사용자를 찾을 수 없습니다.");
  const data = { lastUpdatedAt: new Date() };
  if (changes.name !== undefined) {
    const name = core.normalizeText(changes.name);
    if (!name) throw userError("이름을 입력해 주세요.");
    data.display_name = name;
  }
  if (changes.departmentId !== undefined) {
    const dept = await prisma.schat_departments.findUnique({
      where: { id: Number(changes.departmentId) },
    });
    if (!dept) throw userError("부서를 찾을 수 없습니다.");
    if (!dept.active && dept.id !== user.department_id)
      throw userError("사용중지된 부서로는 옮길 수 없습니다.");
    data.department_id = dept.id;
  }
  if (changes.employeeNumber !== undefined && !user.employee_number) {
    // Legacy accounts (e.g. the first admin) can be given an employee number
    // once; after that the number is fixed.
    const number = core.normalizeEmployeeNumber(changes.employeeNumber);
    if (!/^[A-Za-z0-9-]{1,30}$/.test(number))
      throw userError("사번 형식을 확인해 주세요.");
    const taken = await prisma.users.findUnique({
      where: { employee_number: number },
    });
    if (taken) throw userError("이미 등록된 사번입니다.");
    data.employee_number = number;
  }
  const losingAdmin =
    user.role === "admin" &&
    ((changes.role !== undefined && changes.role !== "admin") ||
      changes.active === false);
  if (changes.role !== undefined) {
    if (!["default", "admin"].includes(changes.role))
      throw userError("권한을 확인해 주세요.");
    data.role = changes.role;
  }
  if (changes.active !== undefined) {
    data.suspended = changes.active ? 0 : 1;
    data.disabled_at = changes.active ? null : new Date();
  }
  if (losingAdmin && actor?.id === user.id)
    throw userError("본인의 관리자 권한이나 사용 상태는 바꿀 수 없습니다.");
  if (losingAdmin && (await countActiveAdmins(user.id)) === 0)
    throw userError(
      "마지막 관리자 계정은 권한을 바꾸거나 사용중지할 수 없습니다."
    );
  if (data.employee_number || data.display_name || data.department_id) {
    const merged = { ...user, ...data };
    if (
      merged.employee_number &&
      (!merged.display_name || !merged.department_id)
    )
      throw userError(
        merged.department_id
          ? "사번 로그인에는 이름이 필요합니다."
          : "부서를 선택해 주세요. 사번이 있는 계정은 부서·사번·이름으로 로그인합니다."
      );
  }
  await prisma.users.update({ where: { id: user.id }, data });
  return presentUser(await getAccount(user.id));
}

// Back to "no password": the old password stops working immediately and the
// employee chooses a new one on the first-login screen.
// ---- 계정 삭제 (완전삭제) ------------------------------------------------------
// Removes the account row. Issue reports stay (reporter link becomes NULL, the
// name/number/department snapshot is kept); the account's own notifications
// and personal chat history are removed by the database cascade. Guide
// counters are anonymous totals and are unaffected.

async function deletionPlan(actor, ids = []) {
  const unique = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!unique.length) throw userError("삭제할 계정을 선택해 주세요.");
  if (unique.length > 500)
    throw userError("한 번에 500명까지 삭제할 수 있습니다.");
  const users = await prisma.users.findMany({
    where: { id: { in: unique } },
    include: USER_INCLUDE,
  });
  const remainingActiveAdmins = await prisma.users.count({
    where: { role: "admin", suspended: 0, id: { notIn: unique } },
  });
  const items = [];
  for (const user of users) {
    const [reports, notifications, chats] = await Promise.all([
      prisma.schat_issue_reports.count({
        where: { reporter_user_id: user.id },
      }),
      prisma.schat_user_notifications.count({ where: { user_id: user.id } }),
      prisma.workspace_chats.count({ where: { user_id: user.id } }),
    ]);
    let blocked = null;
    if (actor?.id === user.id)
      blocked = "현재 로그인 중인 관리자 계정은 삭제할 수 없습니다.";
    else if (user.role === "admin" && remainingActiveAdmins === 0)
      blocked = "마지막 관리자 계정은 삭제할 수 없습니다.";
    items.push({
      ...presentUser(user),
      linked: { reports, notifications, chats },
      blocked,
      warning: !user.suspended
        ? "현재 사용중인 계정입니다. 삭제 대신 사용중지를 권장합니다."
        : null,
    });
  }
  const missing = unique.length - users.length;
  return {
    items,
    missing,
    deletable: items.filter((i) => !i.blocked).length,
    confirmText: items.length === 1 ? items[0].name : "삭제",
  };
}

async function deleteAccounts(actor, ids = [], confirm = "") {
  const plan = await deletionPlan(actor, ids);
  const blocked = plan.items.filter((i) => i.blocked);
  if (blocked.length) throw userError(blocked[0].blocked);
  if (!plan.items.length) throw userError("삭제할 계정을 찾을 수 없습니다.");
  if (core.normalizeText(confirm) !== core.normalizeText(plan.confirmText))
    throw userError(
      plan.items.length === 1
        ? "확인을 위해 직원 이름을 정확히 입력해 주세요."
        : "확인을 위해 '삭제'를 입력해 주세요."
    );
  const targets = plan.items.map((i) => i.id);
  await prisma.users.deleteMany({ where: { id: { in: targets } } });
  // Minimal audit trail for admins: who was removed, by whom, when.
  // No password, hash or chat content is recorded.
  const { EventLogs } = require("../../models/eventLogs");
  for (const item of plan.items)
    await EventLogs.logEvent(
      "user_deleted",
      {
        name: item.name,
        employeeNumber: item.employeeNumber,
        department: item.department,
      },
      actor?.id
    ).catch(() => null);
  return { deletedCount: targets.length };
}

async function setAccountsActive(actor, ids = [], active) {
  const results = { updated: 0, failed: [] };
  for (const id of [...new Set(ids.map(Number))]) {
    try {
      await updateAccount(actor, id, { active: !!active });
      results.updated += 1;
    } catch (error) {
      if (!error.userFacing) throw error;
      results.failed.push({ id, reason: error.message });
    }
  }
  return results;
}

async function resetPassword(actor, id) {
  const user = await getAccount(id);
  if (!user) throw userError("사용자를 찾을 수 없습니다.");
  if (!user.employee_number)
    throw userError("사번이 등록된 계정만 비밀번호를 초기화할 수 있습니다.");
  if (actor?.id === user.id)
    throw userError("본인 비밀번호는 비밀번호 변경 메뉴에서 바꿔 주세요.");
  await prisma.users.update({
    where: { id: user.id },
    data: {
      password: unsetPasswordHash(),
      must_change_password: true,
      lastUpdatedAt: new Date(),
    },
  });
  return { user: presentUser(await getAccount(user.id)) };
}

async function changeOwnPassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.users.findUnique({ where: { id: Number(userId) } });
  if (!user || !comparePassword(currentPassword, user.password))
    throw userError("현재 비밀번호가 맞지 않습니다.");
  const problem = core.validateNewPassword(newPassword, {
    employeeNumber: user.employee_number,
  });
  if (problem) throw userError(problem);
  if (comparePassword(newPassword, user.password))
    throw userError("지금과 다른 비밀번호를 입력해 주세요.");
  await prisma.users.update({
    where: { id: user.id },
    data: {
      password: hashPassword(newPassword),
      must_change_password: false,
      password_changed_at: new Date(),
      lastUpdatedAt: new Date(),
    },
  });
  return presentUser(await getAccount(user.id));
}

// ---- bulk registration (preview -> confirm) -------------------------------

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const previews = new Map(); // token -> {adminId, rows, expiresAt}

async function readTable(buffer, fileName = "") {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return core.parseCsv(buffer.toString("utf8"));
  if (lower.endsWith(".xlsx")) {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const table = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const values = [];
      for (let c = 1; c <= Math.max(row.cellCount, 4); c++) {
        const v = row.getCell(c).value;
        values.push(
          v && typeof v === "object"
            ? (v.text ??
                v.result ??
                (v.richText ? v.richText.map((t) => t.text).join("") : ""))
            : (v ?? "")
        );
      }
      table[rowNumber - 1] = values;
    });
    return Array.from(table, (r) => r || []);
  }
  throw userError("xlsx 또는 csv 파일만 올릴 수 있습니다.");
}

function sweepPreviews() {
  const now = Date.now();
  for (const [token, entry] of previews)
    if (entry.expiresAt < now) previews.delete(token);
}

async function previewBulk(adminId, buffer, fileName) {
  sweepPreviews();
  const table = await readTable(buffer, fileName);
  if (table.length > 1001)
    throw userError("한 번에 1,000명까지 등록할 수 있습니다.");
  const result = core.validateBulkRows(table, {
    departments: await listDepartments(),
    existing: await existingEmployees(),
  });
  if (result.fatal) throw userError(result.fatal);
  const token = crypto.randomBytes(24).toString("hex");
  if (result.valid.length)
    previews.set(token, {
      adminId,
      rows: result.valid,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
  return {
    token: result.valid.length ? token : null,
    total: result.total,
    validCount: result.valid.length,
    errorCount: result.errors.length,
    valid: result.valid.map(({ departmentId: _d, ...row }) => row),
    errors: result.errors,
  };
}

function cancelBulk(adminId, token) {
  const entry = previews.get(token);
  if (entry && entry.adminId === adminId) previews.delete(token);
}

async function commitBulk(adminId, token) {
  const entry = previews.get(token);
  // One-time token: removed before any work so a double click cannot reuse it.
  previews.delete(token);
  if (!entry || entry.adminId !== adminId || entry.expiresAt < Date.now())
    throw userError("등록 전 확인이 만료되었습니다. 파일을 다시 올려 주세요.");
  // Re-check against the live DB in case accounts were added meanwhile.
  const existing = await existingEmployees();
  const departments = new Map((await listDepartments()).map((d) => [d.id, d]));
  const rows = [];
  const skipped = [];
  for (const row of entry.rows) {
    if (
      existing.has(row.employeeNumber) ||
      !departments.get(row.departmentId)?.active
    )
      skipped.push({
        line: row.line,
        employeeNumber: row.employeeNumber,
        reason: "등록 직전 확인에서 제외되었습니다.",
      });
    else rows.push(row);
  }
  const created = [];
  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        const user = await tx.users.create({
          data: newAccountData({ ...row, active: true }),
        });
        created.push({ id: user.id, row });
      }
      await grantAllWorkspaces(
        tx,
        created.map((c) => c.id)
      );
    },
    { timeout: 120000 }
  );
  return {
    createdCount: created.length,
    skipped,
    accounts: created.map(({ row }) => ({
      department: row.department,
      employeeNumber: row.employeeNumber,
      name: row.name,
      role: core.ROLE_LABELS[row.role],
    })),
  };
}

async function buildTemplate() {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("직원등록");
  sheet.addRow(core.TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  sheet.columns = [{ width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
  // Employee numbers keep leading zeros when typed as text.
  sheet.getColumn(2).numFmt = "@";
  const guide = workbook.addWorksheet("입력 안내");
  guide.addRow(["권한 입력값"]);
  guide.addRow(["일반사용자"]);
  guide.addRow(["관리자"]);
  guide.addRow([]);
  guide.addRow(["현재 사용중인 부서"]);
  for (const d of await listDepartments({ activeOnly: true }))
    guide.addRow([d.name]);
  guide.addRow([]);
  guide.addRow([
    "비밀번호는 입력하지 않습니다. 직원이 처음 로그인할 때 직접 정합니다.",
  ]);
  guide.getColumn(1).width = 60;
  return workbook.xlsx.writeBuffer();
}

// ---- issue reports & notifications ---------------------------------------

const REPORT_CATEGORIES = [
  "답변 내용",
  "출처·원문",
  "체크리스트",
  "화면·사용 불편",
  "로그인·계정",
  "기타",
];

function presentReport(report, { forAdmin = false } = {}) {
  return {
    id: report.id,
    category: report.category,
    title: report.title,
    content: report.content,
    relatedFeature: report.related_feature,
    relatedFaqTitle: report.related_faq_title || null,
    status: report.status,
    statusLabel: core.REPORT_STATUS[report.status] || report.status,
    resolution: report.resolution,
    createdAt: report.createdAt,
    inProgressAt: report.in_progress_at,
    resolvedAt: report.resolved_at,
    ...(forAdmin
      ? {
          reporterUserId: report.reporter_user_id,
          reporterDeleted: report.reporter_user_id == null,
          reporterName: report.reporter_name,
          employeeNumber: report.employee_number,
          department: report.department_name,
        }
      : {}),
  };
}

// Only the guide item's id and title are attached, never chat content.
async function relatedFaq(id) {
  if (!id) return {};
  const faq = await prisma.schat_faq_items.findFirst({
    where: { id: Number(id), active: true },
    select: { id: true, title: true },
  });
  return faq ? { related_faq_id: faq.id, related_faq_title: faq.title } : {};
}

async function createReport(userId, input = {}) {
  const user = await getAccount(userId);
  if (!user) throw userError("사용자를 찾을 수 없습니다.");
  const category = core.normalizeText(input.category);
  const title = core.normalizeText(input.title);
  const content = String(input.content ?? "").trim();
  if (!REPORT_CATEGORIES.includes(category))
    throw userError("문제 종류를 선택해 주세요.");
  if (!title || title.length > 100)
    throw userError("제목을 100자 이내로 입력해 주세요.");
  if (!content || content.length > 3000)
    throw userError("상세 내용을 3,000자 이내로 입력해 주세요.");
  const report = await prisma.schat_issue_reports.create({
    data: {
      reporter_user_id: user.id,
      reporter_name: user.display_name || user.username,
      employee_number: user.employee_number,
      department_name: user.department?.name || null,
      reporter_role: user.role,
      category,
      title,
      content,
      ...(await relatedFaq(input.relatedFaqId)),
      related_feature:
        core.normalizeText(input.relatedFeature).slice(0, 100) || null,
    },
  });
  return presentReport(report);
}

async function listMyReports(userId) {
  const reports = await prisma.schat_issue_reports.findMany({
    where: { reporter_user_id: Number(userId) },
    orderBy: { createdAt: "desc" },
  });
  return reports.map((r) => presentReport(r));
}

async function listReports({
  q = "",
  department,
  category,
  status,
  from,
  to,
} = {}) {
  const query = core.normalizeText(q);
  const reports = await prisma.schat_issue_reports.findMany({
    where: {
      ...(department ? { department_name: department } : {}),
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
            },
          }
        : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query } },
              { content: { contains: query } },
              { reporter_name: { contains: query } },
              { employee_number: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return reports.map((r) => presentReport(r, { forAdmin: true }));
}

async function updateReportStatus(adminId, id, { status, resolution }) {
  const report = await prisma.schat_issue_reports.findUnique({
    where: { id: Number(id) },
  });
  if (!report) throw userError("신고를 찾을 수 없습니다.");
  if (!core.REPORT_STATUS[status]) throw userError("상태를 확인해 주세요.");
  const cleanResolution =
    resolution === undefined
      ? report.resolution
      : String(resolution).trim().slice(0, 3000) || null;
  if (status === "resolved" && !cleanResolution)
    throw userError("완료하려면 처리 결과를 입력해 주세요.");
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.schat_issue_reports.update({
      where: { id: report.id },
      data: {
        status,
        resolution: cleanResolution,
        handled_by_user_id: adminId,
        lastUpdatedAt: now,
        ...(status === "in_progress" && !report.in_progress_at
          ? { in_progress_at: now }
          : {}),
        ...(status === "resolved" ? { resolved_at: now } : {}),
        ...(status === "open" ? { resolved_at: null } : {}),
      },
    });
    // Only the reporter is notified, and only when the status really changes.
    if (status !== report.status && core.STATUS_NOTIFICATIONS[status])
      await tx.schat_user_notifications.create({
        data: {
          user_id: report.reporter_user_id,
          report_id: report.id,
          kind: status,
          message: core.STATUS_NOTIFICATIONS[status],
        },
      });
    return saved;
  });
  return presentReport(updated, { forAdmin: true });
}

// Hard delete (admin only, enforced by the endpoint). The notices that
// announced this report's status go with it; an FAQ made from it stays and
// only loses the link (source_report_id is SET NULL by the foreign key).
async function deleteReport(adminId, id) {
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0)
    throw userError("신고를 찾을 수 없습니다.");
  const report = await prisma.schat_issue_reports.findUnique({
    where: { id: reportId },
  });
  if (!report) throw userError("신고를 찾을 수 없습니다.");
  await prisma.$transaction([
    prisma.schat_user_notifications.deleteMany({
      where: { report_id: reportId },
    }),
    prisma.schat_issue_reports.delete({ where: { id: reportId } }),
  ]);
  // Audit: which report and who removed it. The report content is not copied.
  const { EventLogs } = require("../../models/eventLogs");
  await EventLogs.logEvent(
    "schat_report_deleted",
    { reportId, category: report.category, status: report.status },
    adminId
  ).catch(() => null);
  return { id: reportId };
}

async function listNotifications(userId) {
  const rows = await prisma.schat_user_notifications.findMany({
    where: { user_id: Number(userId) },
    include: { report: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return {
    unread: rows.filter((n) => !n.read_at).length,
    items: rows.map((n) => ({
      id: n.id,
      message: n.message,
      kind: n.kind,
      read: !!n.read_at,
      createdAt: n.createdAt,
      report: n.report
        ? {
            id: n.report.id,
            title: n.report.title,
            // Each notice shows the status it announced, not the latest one.
            statusLabel: core.REPORT_STATUS[n.kind] || n.report.status,
            resolution: n.kind === "resolved" ? n.report.resolution : null,
            resolvedAt: n.kind === "resolved" ? n.report.resolved_at : null,
          }
        : null,
    })),
  };
}

// updateMany scoped by user_id: a user can never mark someone else's notice.
async function markNotificationsRead(userId, ids = null) {
  await prisma.schat_user_notifications.updateMany({
    where: {
      user_id: Number(userId),
      read_at: null,
      ...(Array.isArray(ids) ? { id: { in: ids.map(Number) } } : {}),
    },
    data: { read_at: new Date() },
  });
}

async function reportStats() {
  const reports = await prisma.schat_issue_reports.findMany({
    select: {
      status: true,
      category: true,
      department_name: true,
      createdAt: true,
      resolved_at: true,
    },
  });
  return core.reportStatistics(reports);
}

// ---- FAQ ---------------------------------------------------------------------

function presentFaq(faq) {
  return {
    id: faq.id,
    title: faq.title,
    category: faq.category,
    keywords: faq.keywords,
    problem: faq.problem,
    solution: faq.solution,
    active: faq.active,
    sourceReportId: faq.source_report_id,
    viewCount: faq.view_count ?? 0,
    helpfulCount: faq.helpful_count ?? 0,
    notHelpfulCount: faq.not_helpful_count ?? 0,
  };
}

// What staff see in 이용 가이드: active items only, no admin-side fields
// (source report, counters).
function presentGuide(faq) {
  return {
    id: faq.id,
    title: faq.title,
    category: faq.category || "기타",
    keywords: faq.keywords,
    problem: faq.problem,
    solution: faq.solution,
  };
}

async function listGuide({ q = "", category = "" } = {}) {
  const faqs = await prisma.schat_faq_items.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
  return core.searchGuide(faqs, { q, category }).map(presentGuide);
}

const FEEDBACK_FIELDS = {
  view: "view_count",
  helpful: "helpful_count",
  not_helpful: "not_helpful_count",
};

// Anonymous counters for improving the guide; who clicked is not stored.
async function recordGuideFeedback(id, type) {
  const field = FEEDBACK_FIELDS[type];
  if (!field) throw userError("잘못된 요청입니다.");
  const { count } = await prisma.schat_faq_items.updateMany({
    where: { id: Number(id), active: true },
    data: { [field]: { increment: 1 } },
  });
  if (!count) throw userError("이용 가이드를 찾을 수 없습니다.");
}

// FAQ 삭제 (admin only, enforced by the endpoint). Reports that linked this
// FAQ keep their own copy of its title (related_faq_title), so they are not
// changed. The FAQ disappears from 이용 가이드 and report suggestions at once.
async function deleteFaq(adminId, id) {
  const faqId = Number(id);
  if (!Number.isInteger(faqId) || faqId <= 0)
    throw userError("FAQ를 찾을 수 없습니다.");
  const faq = await prisma.schat_faq_items.findUnique({ where: { id: faqId } });
  if (!faq) throw userError("FAQ를 찾을 수 없습니다.");
  await prisma.schat_faq_items.delete({ where: { id: faqId } });
  const { EventLogs } = require("../../models/eventLogs");
  await EventLogs.logEvent(
    "schat_faq_deleted",
    { faqId, category: faq.category || null },
    adminId
  ).catch(() => null);
  return { id: faqId };
}

async function listFaqs({ activeOnly = false } = {}) {
  const faqs = await prisma.schat_faq_items.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: { lastUpdatedAt: "desc" },
  });
  return faqs.map(presentFaq);
}

async function saveFaq({
  id = null,
  title,
  category,
  keywords,
  problem,
  solution,
  active,
  sourceReportId,
}) {
  const data = {
    title: core.normalizeText(title),
    category: core.normalizeText(category) || null,
    keywords:
      String(keywords ?? "")
        .trim()
        .slice(0, 500) || null,
    problem:
      String(problem ?? "")
        .trim()
        .slice(0, 3000) || null,
    solution: String(solution ?? "")
      .trim()
      .slice(0, 3000),
    active: active === true,
    lastUpdatedAt: new Date(),
    ...(sourceReportId ? { source_report_id: Number(sourceReportId) } : {}),
  };
  if (!data.title) throw userError("FAQ 제목을 입력해 주세요.");
  if (!data.solution) throw userError("해결 방법을 입력해 주세요.");
  const saved =
    id === null
      ? await prisma.schat_faq_items.create({ data })
      : await prisma.schat_faq_items.update({
          where: { id: Number(id) },
          data,
        });
  return presentFaq(saved);
}

async function suggestFaqs(query) {
  const faqs = await prisma.schat_faq_items.findMany({
    where: { active: true },
  });
  return core.suggestFaqs(query, faqs).map(presentFaq);
}

module.exports = {
  REPORT_CATEGORIES,
  presentUser,
  listDepartments,
  saveDepartment,
  deleteDepartment,
  legacyLoginAvailable,
  employeeLogin,
  firstLoginCheck,
  listGuide,
  recordGuideFeedback,
  firstLogin,
  getAccount,
  listAccounts,
  createAccount,
  updateAccount,
  resetPassword,
  deletionPlan,
  deleteAccounts,
  setAccountsActive,
  changeOwnPassword,
  previewBulk,
  cancelBulk,
  commitBulk,
  buildTemplate,
  createReport,
  listMyReports,
  listReports,
  updateReportStatus,
  deleteReport,
  listNotifications,
  markNotificationsRead,
  reportStats,
  listFaqs,
  saveFaq,
  deleteFaq,
  suggestFaqs,
};
