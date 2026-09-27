import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHAT_ADMIN_SECTIONS, findSchatAdminSection } from "./menu.js";
import { promptInheritance } from "./promptInheritance.js";
import { listedThreads } from "../../utils/threadList.js";

const src = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("the wrench opens exactly the SCHAT admin sections in order", () => {
  assert.deepEqual(
    SCHAT_ADMIN_SECTIONS.map((section) => section.label),
    [
      "브랜드 관리",
      "답변 설정",
      "사용자 관리",
      "문제 신고",
      "퀴즈 관리",
      "시스템 연결",
      "시스템 상태",
      "저장공간 정리",
      "위험 설정",
    ]
  );
  assert.equal(findSchatAdminSection("nope").key, "brand");
  const labels = SCHAT_ADMIN_SECTIONS.map((s) => s.label).join(" ");
  assert.doesNotMatch(labels, /글자 크기|다크/);
});

test("settings sidebar no longer links the upstream menus", () => {
  const sidebar = src("../../components/SettingsSidebar/index.jsx");
  for (const hidden of [
    "llmPreference",
    "vectorDatabase",
    "chunkingPreference",
    "imageGenerationPreference",
    "audioPreference",
    "transcriptionPreference",
    "modelRouters",
    "agentSkills",
    "communityHub",
    "embedChatWidgets",
    "apiKeys",
    "systemPromptVariables",
    "browserExtension",
    "settings.mobile",
    "privacy",
    "SupportEmail",
    "AppVersion",
    "invites",
  ])
    assert.equal(sidebar.includes(hidden), false, hidden);
  assert.match(sidebar, /SCHAT_ADMIN_SECTIONS\.map/);
  assert.match(sidebar, /roles=\{\["admin"\]\}/);
});

test("only admins get the wrench, and it opens the SCHAT admin screen", () => {
  const button = src("../../components/SettingsButton/index.jsx");
  assert.match(button, /user\?\.role !== "admin"\) return null/);
  assert.match(button, /paths\.settings\.schatAdmin\(\)/);
  const main = src("../../main.jsx");
  assert.match(
    main,
    /path: "\/settings\/schat\/:section"[\s\S]*?AdminRoute Component=\{SchatAdmin\}/
  );
  assert.match(
    main,
    /path: "\/workspace\/:slug\/settings\/:tab",\s*element: <Navigate to="\/settings\/schat\/brand" replace \/>/
  );
});

test("staff chat keeps only text input, send and sign-out", () => {
  const workspaces = src("../../components/Sidebar/ActiveWorkspaces/index.jsx");
  assert.equal(workspaces.includes("GearSix"), false);
  assert.match(src("../../utils/schatUi.js"), /SCHAT_TEXT_ONLY_INPUT = true/);
  const prompt = src(
    "../../components/WorkspaceChat/ChatContainer/PromptInput/index.jsx"
  );
  assert.match(prompt, /!SCHAT_TEXT_ONLY_INPUT && \(\s*<ToolsMenu/);
  assert.match(
    src("../../components/WorkspaceChat/ChatContainer/DnDWrapper/index.jsx"),
    /disabled: !ready \|\| SCHAT_TEXT_ONLY_INPUT/
  );
  assert.match(
    src(
      "../../components/Modals/ManageWorkspace/Documents/UploadFile/index.jsx"
    ),
    /SHOW_LINK_UPLOAD = false/
  );
  assert.match(
    src("../../components/lib/QuickActions/index.jsx"),
    /if \(!SHOW_QUICK_ACTIONS\) return null/
  );
  const user = src("../../components/UserMenu/UserButton/index.jsx");
  assert.match(user, /로그아웃/);
  for (const removed of [
    "AccountModal",
    "profile_settings.account",
    "profile_settings.support",
    "UserDisplay",
  ])
    assert.equal(user.includes(removed), false, removed);
});

test("empty new conversations are not listed until the first message names them", () => {
  const threads = [
    { slug: "a", name: "수혈 절차" },
    { slug: "b", name: "Thread" },
    { slug: "c", name: "Thread", deleted: true },
  ];
  assert.deepEqual(
    listedThreads(threads).map((t) => t.slug),
    ["a", "c"]
  );
  const container = src(
    "../../components/Sidebar/ActiveWorkspaces/ThreadContainer/index.jsx"
  );
  assert.equal(container.includes("New Thread"), false);
  assert.match(container, /새 대화/);
  assert.match(container, /const showVirtualThread = false/);
});

test("a workspace without its own prompt inherits the default answer rule", () => {
  assert.deepEqual(promptInheritance({ openAiPrompt: null }, "규칙"), {
    inherits: true,
    sameAsDefault: false,
  });
  assert.deepEqual(promptInheritance({ openAiPrompt: " 규칙 " }, "규칙"), {
    inherits: false,
    sameAsDefault: true,
  });
  assert.deepEqual(promptInheritance({ openAiPrompt: "" }, "규칙"), {
    inherits: false,
    sameAsDefault: false,
  });
});

test("user management offers only admin and staff roles", () => {
  const users = src("./sections/Users.jsx");
  const labels = users.match(/export const ROLE_LABELS = \{([^}]*)\}/)[1];
  assert.match(labels, /default: "일반사용자"/);
  assert.match(labels, /admin: "관리자"/);
  assert.doesNotMatch(labels, /manager/);
  // an existing manager account stays visible instead of silently changing
  assert.match(users, /manager: "매니저\(이전 역할\)"/);
  assert.match(users, /roleOptions\(user\.role\)\.map/);
});

test("document folder shows a Korean name without changing its key", async () => {
  const { folderDisplayName } = await import("../../utils/directories.js");
  assert.equal(folderDisplayName("custom-documents"), "등록된 문서");
  assert.equal(folderDisplayName("my-folder"), "my-folder");
  const row = src(
    "../../components/Modals/ManageWorkspace/Documents/Directory/FolderRow/index.jsx"
  );
  assert.match(row, /middleTruncate\(folderDisplayName\(item\.name\), 35\)/);
  assert.match(row, /onToggleExpanded\(item\.name\)/);
  const upload = src(
    "../../components/Modals/ManageWorkspace/Documents/UploadFile/index.jsx"
  );
  assert.equal(upload.includes("connectors.upload.file-types"), false);
  assert.match(upload, /connectors\.upload\.click-upload/);
});

test("document screen hides raw file counts and shows documents and pages", async () => {
  const { workspaceDocumentSummary } = await import(
    "../../components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/workspaceDocumentPresentation.js"
  );
  assert.deepEqual(
    workspaceDocumentSummary([
      { kind: "pdf", entries: new Array(461).fill({}) },
      { kind: "pdf", entries: new Array(82).fill({}) },
    ]),
    { documents: 2, pages: 543 }
  );
  const directory = src(
    "../../components/Modals/ManageWorkspace/Documents/Directory/index.jsx"
  );
  assert.match(directory, /const SHOW_LIBRARY_TOTAL = false/);
  assert.match(directory, /displayCount: 0,/);
  const workspaceDir = src(
    "../../components/Modals/ManageWorkspace/Documents/WorkspaceDirectory/index.jsx"
  );
  assert.match(workspaceDir, /등록 문서 \{documentSummary\.documents\}개 · 총/);
});

test("storage cleanup deletes only after preview and a final confirmation", async () => {
  const storage = src("./sections/Storage.jsx");
  assert.doesNotMatch(storage, /DELETE_ENABLED/);
  assert.doesNotMatch(storage, /아직 승인 전이라/);
  assert.match(storage, /disabled=\{!selectable\}/);
  // 삭제 진행 only opens the final confirmation; the dialog sends the delete
  assert.match(storage, /onClick=\{onDelete\}/);
  assert.match(storage, /confirming && preview\?\.ok &&/);
  assert.match(storage, /예전 데이터를 삭제하시겠습니까\?/);
  assert.match(storage, /이 작업은 되돌릴 수 없습니다\./);
  assert.match(
    storage,
    /SchatAdmin\.storageDelete\(\s*selected,\s*preview\?\.previewToken\s*\)/
  );
  assert.match(storage, /예전 데이터가 삭제되었습니다\./);
  const model = src("../../models/schatAdmin.js");
  assert.match(model, /storage-cleanup\/delete/);
  assert.match(model, /previewToken, confirm: true/);
});

test("staff log in with department, employee number, name and password", () => {
  const form = src("../../components/Modals/Password/EmployeeLoginForm.jsx");
  for (const field of [
    'name="department"',
    'name="employeeNumber"',
    'name="name"',
    'name="password"',
  ])
    assert.ok(form.includes(field), field);
  assert.match(form, /로그인 정보를 다시 확인해주세요\./);
  assert.match(form, /legacyAvailable &&/);
  const auth = src("../../components/Modals/Password/MultiUserAuth.jsx");
  assert.match(auth, /if \(!legacyMode\)\s*return \(\s*<EmployeeLoginForm/);
});

test("first-time employees set their own password; no temporary passwords", async () => {
  const form = src("../../components/Modals/Password/EmployeeLoginForm.jsx");
  assert.match(
    form,
    /if \(result\?\.firstLoginRequired\) return setFirstLogin\(identity\)/
  );
  assert.match(form, /SchatAccount\.firstLogin\(/);
  assert.match(form, /name="newPassword"/);
  assert.match(form, /name="confirmPassword"/);
  const routes = src("../../components/PrivateRoute/index.jsx");
  assert.equal(routes.includes("PasswordChangeRequired"), false);
  for (const file of ["./sections/Users.jsx", "./sections/UsersBulk.jsx"]) {
    const body = src(file);
    assert.equal(body.includes("tempPassword"), false, file);
    assert.equal(body.includes("임시"), false, file);
  }
  const { resultCsv } = await import("./sections/UsersBulk.jsx").catch(
    () => ({})
  );
  if (resultCsv) assert.doesNotMatch(resultCsv([]), /비밀번호/);
  const menu = src("../../components/UserMenu/UserButton/index.jsx");
  for (const item of ["문제 신고", "내 신고", "비밀번호 변경", "로그아웃"])
    assert.ok(menu.includes(item), item);
  assert.match(menu, /<NotificationBell \/>/);
});

test("bulk registration result lists accounts without any password column", () => {
  const bulk = src("./sections/UsersBulk.jsx");
  assert.match(bulk, /정상 \{preview\.validCount\}명 등록/);
  assert.match(bulk, /disabled=\{!preview\.token \|\| committing\}/);
  assert.match(bulk, /\["부서", "사번", "이름", "권한"\]/);
});

test("이용 가이드 is a staff page under 새 대화 using the same FAQ data", () => {
  const page = src("../Guide/index.jsx");
  assert.match(page, /이용 가이드/);
  assert.match(page, /필요한 해결 방법을 빠르게 찾아보세요\./);
  assert.match(page, /등록된 이용 가이드가 없습니다\./);
  assert.match(page, /도움이 되었나요\?/);
  assert.match(page, /해결되지 않았어요 · 문제 신고/);
  assert.match(page, /aria-expanded=\{open\}/);
  assert.match(page, /<ReportModal[\s\S]*relatedFaq=\{reportFaq\}/);
  const sidebar = src("../../components/Sidebar/index.jsx");
  assert.equal(
    (
      sidebar.match(
        /<ActiveWorkspaces \/>\s*<QuizLink \/>\s*<GuideLink \/>/g
      ) || []
    ).length,
    2
  );
  const main = src("../../main.jsx");
  assert.match(
    main,
    /path: "\/guide"[\s\S]*?PrivateRoute Component=\{GuidePage\}/
  );
  const icon = src("../../components/SchatGuide/GuideIcon.jsx");
  assert.match(icon, /schat-guide-icon__bubble/);
  assert.match(icon, /schat-guide-icon__mark/);
});

test("login offers 비밀번호 만들기 with an identity check first", () => {
  const form = src("../../components/Modals/Password/EmployeeLoginForm.jsx");
  assert.match(form, /처음 사용하시나요\? 비밀번호 만들기/);
  assert.match(form, /SchatAccount\.firstLoginCheck\(identity\)/);
  assert.match(form, /aria-label="비밀번호 만들기"/);
});
