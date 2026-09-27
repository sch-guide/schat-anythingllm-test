const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../../utils/schatAccounts/core");

// Synthetic people only.
const compare = (plain, hash) => hash === `hash:${plain}`;
const user = {
  id: 7,
  employee_number: "T0001",
  display_name: "가상 직원",
  department: { name: "가상병동" },
  password: "hash:correct-pass",
  suspended: 0,
};
const login = (overrides = {}, account = user) =>
  core.checkEmployeeLogin(
    {
      department: "가상병동",
      employeeNumber: "T0001",
      name: "가상 직원",
      password: "correct-pass",
      ...overrides,
    },
    account,
    compare
  );

test("employee login needs department, number, name and password to all match", () => {
  assert.equal(login().ok, true);
  // whitespace is normalized, not a reason to fail
  assert.equal(
    login({
      department: " 가상병동 ",
      employeeNumber: " T 0001",
      name: "가상  직원 ",
    }).ok,
    true
  );
  const failures = [
    login({ department: "다른병동" }),
    login({ employeeNumber: "T0002" }),
    login({ name: "다른 직원" }),
    login({ password: "wrong" }),
    login({}, { ...user, suspended: 1 }),
    login({}, null),
    login({ password: "" }),
  ];
  for (const result of failures) {
    assert.equal(result.ok, false);
    assert.equal(result.message, "로그인 정보를 다시 확인해주세요.");
  }
});

test("new or reset accounts go to 처음 로그인 instead of accepting a password", () => {
  const unset = { ...user, must_change_password: true };
  // identity matches: redirect to first login, whatever password is typed
  assert.deepEqual(login({ password: "" }, unset), {
    ok: false,
    firstLoginRequired: true,
  });
  assert.deepEqual(login({ password: "anything" }, unset), {
    ok: false,
    firstLoginRequired: true,
  });
  // identity does not match: same generic failure as any other login
  assert.equal(
    login({ name: "다른 직원", password: "" }, unset).firstLoginRequired,
    undefined
  );
  assert.equal(
    login({ password: "" }, { ...unset, suspended: 1 }).message,
    "로그인 정보를 다시 확인해주세요."
  );
  // an account that already has a password needs it
  assert.equal(login({ password: "" }).ok, false);
  assert.equal(login({ password: "" }).firstLoginRequired, undefined);
});

test("first-login setup only works while no password is set", () => {
  const unset = { ...user, must_change_password: true };
  const input = (o = {}) => ({
    department: "가상병동",
    employeeNumber: "T0001",
    name: "가상 직원",
    newPassword: "new-pass-2026",
    confirmPassword: "new-pass-2026",
    ...o,
  });
  assert.equal(core.checkFirstLogin(input(), unset).ok, true);
  // already set -> cannot enter first login again
  assert.match(
    core.checkFirstLogin(input(), user).message,
    /이미 비밀번호가 설정된 계정입니다/
  );
  assert.equal(
    core.checkFirstLogin(input({ name: "다른 직원" }), unset).ok,
    false
  );
  assert.equal(
    core.checkFirstLogin(input(), { ...unset, suspended: 1 }).ok,
    false
  );
  assert.match(
    core.checkFirstLogin(input({ confirmPassword: "x" }), unset).message,
    /서로 다릅니다/
  );
  assert.match(
    core.checkFirstLogin(
      input({ newPassword: "short", confirmPassword: "short" }),
      unset
    ).message,
    /8자 이상/
  );
});

test("password rules for self-chosen passwords", () => {
  assert.equal(
    core.validateNewPassword("short1"),
    "비밀번호는 8자 이상이어야 합니다."
  );
  assert.match(core.validateNewPassword("onlyletters"), /두 가지 이상/);
  assert.match(
    core.validateNewPassword("abcT0001xyz", { employeeNumber: "T0001" }),
    /사번이 들어간/
  );
  assert.equal(core.validateNewPassword("new-pass-2026"), null);
});

test("employee numbers are masked for display and mapped to a safe username", () => {
  assert.equal(core.maskEmployeeNumber("10001"), "10**1");
  assert.equal(core.internalUsername("A-10 01"), "emp-a-10-01");
});

test("bulk rows: valid rows pass and every problem is reported per line", () => {
  const departments = [
    { id: 1, name: "가상병동", active: true },
    { id: 2, name: "닫힌병동", active: false },
  ];
  const existing = new Map([
    ["T0500", { name: "기존 직원", department: "가상병동" }],
  ]);
  const table = [
    ["부서", "사번", "이름", "권한"],
    ["가상병동", "T0001", "직원 하나", "일반사용자"], // 2 ok
    ["가상병동", "T0002", "직원 둘", ""], // 3 ok (default role)
    [" ", "", "", ""], // 4 blank row, ignored
    ["", "T0003", "직원 셋", "일반사용자"], // 5 department missing
    ["가상병동", "", "직원 넷", "일반사용자"], // 6 number missing
    ["가상병동", "T0005", "", "일반사용자"], // 7 name missing
    ["가상병동", "T0006", "직원 여섯", "슈퍼유저"], // 8 bad role
    ["가상병동", "T0007", "직원 일곱", "일반사용자"], // 9 dup in file
    ["가상병동", "T0007", "직원 일곱", "일반사용자"], // 10 dup in file
    ["가상병동", "T0008", "직원 여덟", "일반사용자"], // 11 same number,
    ["가상병동", "T0008", "다른 이름", "일반사용자"], // 12 different name
    ["가상병동", "T0500", "기존 직원", "일반사용자"], // 13 already registered
    ["닫힌병동", "T0009", "직원 아홉", "일반사용자"], // 14 inactive dept
    ["없는병동", "T0010", "직원 열", "관리자"], // 15 unknown dept
  ];
  const result = core.validateBulkRows(table, { departments, existing });
  assert.equal(result.fatal, null);
  assert.equal(result.total, 13); // 14 rows minus the blank one
  assert.deepEqual(
    result.valid.map((r) => [r.line, r.employeeNumber, r.role, r.departmentId]),
    [
      [2, "T0001", "default", 1],
      [3, "T0002", "default", 1],
    ]
  );
  const byLine = Object.fromEntries(result.errors.map((e) => [e.line, e]));
  assert.match(byLine[5].reasons.join(), /부서가 비어/);
  assert.match(byLine[6].reasons.join(), /사번이 비어/);
  assert.match(byLine[7].reasons.join(), /이름이 없습니다/);
  assert.match(byLine[8].reasons.join(), /권한은/);
  assert.match(byLine[9].reasons.join(), /여러 번/);
  assert.match(byLine[10].reasons.join(), /여러 번/);
  assert.match(byLine[11].reasons.join(), /이름 또는 부서가 다른/);
  assert.match(byLine[12].reasons.join(), /이름 또는 부서가 다른/);
  assert.equal(byLine[13].status, "이미 등록됨");
  assert.match(byLine[14].reasons.join(), /사용중지된 부서/);
  assert.match(byLine[15].reasons.join(), /등록되지 않았거나/);
  assert.equal(result.errors.length, 11);

  assert.match(
    core.validateBulkRows([["이름", "권한"]], { departments, existing }).fatal,
    /필수 칸/
  );
});

test("csv reader handles BOM, quotes and CRLF", () => {
  assert.deepEqual(
    core.parseCsv('﻿부서,사번,이름\r\n"가상, 병동",T1,"직원 ""A"""\r\n'),
    [
      ["부서", "사번", "이름"],
      ["가상, 병동", "T1", '직원 "A"'],
    ]
  );
});

test("FAQ suggestions come from active items by keyword only", () => {
  const faqs = [
    {
      id: 1,
      title: "체크리스트가 열리지 않을 때",
      keywords: "체크리스트, 팝업",
      active: true,
    },
    {
      id: 2,
      title: "팝업 차단 해제 방법",
      keywords: "팝업, 차단",
      active: true,
    },
    { id: 3, title: "비활성 항목", keywords: "체크리스트", active: false },
  ];
  assert.deepEqual(
    core.suggestFaqs("체크리스트 창이 안 열려요", faqs).map((f) => f.id),
    [1]
  );
  assert.deepEqual(
    core
      .suggestFaqs("팝업이 차단됐어요", faqs)
      .map((f) => f.id)
      .sort(),
    [1, 2]
  );
  assert.deepEqual(core.suggestFaqs("", faqs), []);
});

test("report statistics count by status, department and time without ranking people", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const stats = core.reportStatistics(
    [
      {
        status: "open",
        category: "체크리스트",
        department_name: "가상병동",
        createdAt: "2026-09-26T12:00:00Z",
      },
      {
        status: "resolved",
        category: "체크리스트",
        department_name: "가상병동",
        createdAt: "2026-09-20T12:00:00Z",
        resolved_at: "2026-09-20T14:00:00Z",
      },
      {
        status: "in_progress",
        category: "답변 내용",
        department_name: null,
        createdAt: "2026-08-01T12:00:00Z",
      },
    ],
    now
  );
  assert.deepEqual(stats.byStatus, { open: 1, in_progress: 1, resolved: 1 });
  assert.equal(stats.recent7, 2);
  assert.equal(stats.recent30, 2);
  assert.equal(stats.averageResolutionHours, 2);
  assert.deepEqual(stats.byDepartment, { 가상병동: 2, "부서 없음": 1 });
  assert.equal(JSON.stringify(stats).includes("reporter"), false);
});

test("비밀번호 만들기 step 1 tells only a matching employee that a password exists", () => {
  const unset = { ...user, must_change_password: true };
  const input = {
    department: "가상병동",
    employeeNumber: "T0001",
    name: "가상 직원",
  };
  assert.deepEqual(core.checkFirstLoginIdentity(input, unset), { ok: true });
  const already = core.checkFirstLoginIdentity(input, user);
  assert.equal(already.alreadySet, true);
  assert.match(already.message, /이미 비밀번호가 설정된 계정입니다/);
  // unknown or mismatched details: generic message, no hint of existence
  for (const result of [
    core.checkFirstLoginIdentity(input, null),
    core.checkFirstLoginIdentity({ ...input, name: "다른 직원" }, unset),
    core.checkFirstLoginIdentity(input, { ...unset, suspended: 1 }),
  ]) {
    assert.equal(result.ok, false);
    assert.equal(result.alreadySet, undefined);
    assert.equal(result.message, "로그인 정보를 다시 확인해주세요.");
  }
  // setting a password on an account that already has one is refused
  assert.equal(
    core.checkFirstLogin(
      {
        ...input,
        newPassword: "new-pass-2026",
        confirmPassword: "new-pass-2026",
      },
      user
    ).alreadySet,
    true
  );
});

test("attempt limiter blocks a key after repeated failures until the window passes", () => {
  let now = 0;
  const limiter = core.createAttemptLimiter({
    max: 3,
    windowMs: 1000,
    now: () => now,
  });
  const keys = ["ip:1", "emp:T1"];
  limiter.fail(keys);
  limiter.fail(keys);
  assert.equal(limiter.blocked(keys), false);
  limiter.fail(["ip:2", "emp:T1"]);
  assert.equal(limiter.blocked(["ip:9", "emp:T1"]), true); // number blocked from any IP
  assert.equal(limiter.blocked(["ip:9", "emp:T2"]), false);
  now = 1500;
  assert.equal(limiter.blocked(keys), false);
  limiter.fail(keys);
  limiter.reset(["emp:T1"]);
  assert.equal(limiter.blocked(["emp:T1"]), false);
});

test("guide search covers title, problem, keywords and solution of active items", () => {
  const faqs = [
    {
      id: 1,
      title: "체크리스트가 열리지 않을 때",
      category: "체크리스트",
      keywords: "팝업",
      problem: "버튼을 눌러도 안 열림",
      solution: "새로고침합니다.",
      active: true,
    },
    {
      id: 2,
      title: "PDF 원문이 열리지 않을 때",
      category: "출처·원문",
      keywords: "",
      problem: "",
      solution: "다른 브라우저로 접속합니다.",
      active: true,
    },
    {
      id: 3,
      title: "숨김 항목",
      category: "체크리스트",
      keywords: "팝업",
      problem: "",
      solution: "비공개",
      active: false,
    },
  ];
  const ids = (o) => core.searchGuide(faqs, o).map((f) => f.id);
  assert.deepEqual(ids({}), [1, 2]);
  assert.deepEqual(ids({ q: "팝업" }), [1]);
  assert.deepEqual(ids({ q: "브라우저" }), [2]);
  assert.deepEqual(ids({ q: "열리지 원문" }), [2]);
  assert.deepEqual(ids({ category: "체크리스트" }), [1]);
  assert.deepEqual(ids({ q: "비공개" }), []);
});
