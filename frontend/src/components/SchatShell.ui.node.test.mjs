import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("사이드바는 원래 프로그램 위치의 SCHAT 글자만 표시하고 SCHC 배지는 쓰지 않는다", () => {
  const brand = source("./Sidebar/SchatBrand.jsx");
  const sidebar = source("./Sidebar/index.jsx");
  const settingsSidebar = source("./SettingsSidebar/index.jsx");

  assert.doesNotMatch(brand, /SCHC/);
  assert.match(brand, />\s*SCHAT\s*</);
  assert.doesNotMatch(brand, /<img/);
  assert.match(sidebar, /\.\/SchatBrand/);
  assert.match(settingsSidebar, /\.\.\/Sidebar\/SchatBrand/);
});

test("채팅 설정은 원래 프로그램 위치의 다크모드 버튼을 사용한다", () => {
  const menu = source(
    "./WorkspaceChat/ChatContainer/ChatSettingsMenu/index.jsx"
  );
  const darkMode = source(
    "./WorkspaceChat/ChatContainer/ChatSettingsMenu/DarkMode/index.jsx"
  );

  assert.match(menu, /<TextSizeRow\s*\/>/);
  assert.match(menu, /<DarkModeRow\s*\/>/);
  assert.doesNotMatch(menu, /MemoriesRow|ExportRow|CopyLinkToChatRow/);
  assert.match(menu, /\.\/DarkMode/);
  assert.match(darkMode, /useTheme/);
  assert.match(darkMode, /setTheme\(isLight \? "dark" : "light"\)/);
  assert.match(darkMode, /다크모드/);
});

test("모델 선택과 답변 성능 정보는 코드로 보존하되 화면에는 표시하지 않는다", () => {
  const picker = source(
    "./WorkspaceChat/ChatContainer/WorkspaceModelPicker/index.jsx"
  );
  const chat = source("./WorkspaceChat/ChatContainer/index.jsx");
  const home = source("../pages/Main/Home/index.jsx");
  const metrics = source(
    "./WorkspaceChat/ChatContainer/ChatHistory/HistoricalMessage/Actions/RenderMetrics/index.jsx"
  );
  const actions = source(
    "./WorkspaceChat/ChatContainer/ChatHistory/HistoricalMessage/Actions/index.jsx"
  );

  assert.match(picker, /export default function WorkspaceModelPicker/);
  assert.doesNotMatch(chat, /WorkspaceModelPicker/);
  assert.doesNotMatch(home, /WorkspaceModelPicker/);
  assert.match(metrics, /export default function RenderMetrics/);
  assert.doesNotMatch(actions, /RenderMetrics/);
});

test("하단 설정 버튼은 관리자와 단일 사용자에게만 보인다", () => {
  const footer = source("./Footer/index.jsx");

  assert.match(footer, /useUser/);
  assert.match(footer, /user\.role !== "admin"/);
  assert.match(footer, /<SettingsButton\s*\/>/);
  assert.doesNotMatch(
    footer,
    /<GithubLogo|<DiscordLogo|<BookOpen|fetchCustomFooterIcons/
  );
});

test("일반 화면은 하나의 SCHAT 산세리프 글꼴을 사용하고 코드 글꼴은 유지한다", () => {
  const globalCss = source("../index.css");
  const brandCss = source("../schat-brand.css");
  const tailwind = source("../../tailwind.config.js");

  assert.match(
    globalCss,
    /--schat-font-sans:\s*Pretendard,\s*Inter,\s*system-ui,\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*sans-serif;/
  );
  assert.match(globalCss, /html,\s*body\s*{[^}]*font-family:\s*var\(--schat-font-sans\)/s);
  assert.match(
    globalCss,
    /button,\s*input,\s*select,\s*textarea\s*{[^}]*font-family:\s*var\(--schat-font-sans\)/s
  );
  assert.match(tailwind, /sans:\s*\[\s*"var\(--schat-font-sans\)"\s*\]/);
  assert.doesNotMatch(brandCss, /font-family:\s*Pretendard/);
  assert.match(globalCss, /@font-face\s*{[^}]*font-family:\s*"plus-jakarta-sans"/s);
  assert.match(source("../utils/chat/markdown.js"), /font-mono/);
});
