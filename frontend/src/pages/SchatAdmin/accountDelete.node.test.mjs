import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("account deletion always previews and asks for a typed confirmation", () => {
  const dialog = src("./sections/UsersDelete.jsx");
  assert.match(dialog, /SchatAccount\.deletePreview\(ids\)/);
  assert.match(dialog, /SchatAccount\.deleteAccounts\(ids, confirm\)/);
  assert.match(dialog, /confirm\.trim\(\) !== plan\.confirmText\.trim\(\)/);
  assert.match(dialog, /blocked\.length > 0/);
  assert.match(dialog, /퇴사·휴직은/);
  assert.match(dialog, /\(삭제된 사용자\)/);
});

test("the list keeps only 수정 and 사용중지; delete and reset live in 수정", () => {
  const users = src("./sections/Users.jsx");
  const list = users.slice(
    users.indexOf("function AccountList"),
    users.indexOf("function EditAccount")
  );
  // each row has only 수정; account actions live in the edit screen
  assert.doesNotMatch(list, /\{u\.active \? "사용중지" : "다시 사용"\}/);
  assert.match(list, /schat-sticky-action/);
  assert.match(list, /min-w-\[640px\]/);
  assert.doesNotMatch(list, /완전삭제/);
  assert.doesNotMatch(list, /비밀번호 초기화<\/Button>|setResetting/);
  assert.match(list, /whitespace-nowrap/);
  assert.match(list, /비밀번호 미설정/);
  assert.match(list, /선택 사용자 삭제/);
  assert.doesNotMatch(users, /전체 (사용자 )?삭제/);
  // the signed-in admin cannot be selected
  assert.match(list, /disabled=\{me\?\.id === u\.id\}/);
  const edit = users.slice(users.indexOf("function EditAccount"));
  assert.match(edit, /계정 관리/);
  assert.match(edit, /계정 상태/);
  assert.match(edit, /최근 로그인: \{when\(user\.lastLoginAt\)\}/);
  assert.match(edit, /\{account\.active \? "사용중지" : "다시 사용"\}/);
  assert.match(edit, /비밀번호 초기화/);
  assert.match(edit, /위험 영역/);
  assert.match(edit, /disabled=\{deleteBlock !== null\}/);
  assert.match(edit, /SchatAccount\.deletePreview\(\[user\.id\]\)/);
  const ui = src("./ui.jsx");
  assert.match(ui, /schat-admin-badge--\$\{tone\}[^"`]*whitespace-nowrap/);
});

test("reports of deleted accounts stay visible with their snapshot", () => {
  const reports = src("./sections/Reports.jsx");
  assert.match(reports, /r\.reporterDeleted/);
  assert.match(reports, /report\.reporterDeleted \? " \(삭제된 사용자\)"/);
});
