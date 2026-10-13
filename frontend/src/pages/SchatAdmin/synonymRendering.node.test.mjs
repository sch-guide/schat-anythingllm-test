import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { setImmediate } from "node:timers/promises";
import * as review from "./synonymReview.js";
import { SCHAT_ADMIN_TITLE, findSchatAdminSection } from "./menu.js";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { transformSync } = require("esbuild");
function load(file, deps, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    { loader: "jsx", format: "cjs", jsx: "automatic" }
  );
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in deps ? deps[name] : require(name)),
    ...globals,
  });
  return module.exports;
}
const ui = load("./ui.jsx", {});
const sectionDeps = {
  "@/models/schatSynonyms": {},
  "@/utils/toast": () => {},
  "@/components/WorkspaceChat/ChatContainer/ChatHistory/Citation/PdfPageViewer":
    () => null,
  "../ui": ui,
  "../menu": { SCHAT_ADMIN_TITLE, findSchatAdminSection },
  "../synonymReview": review,
  "../synonymTable.css": {},
};
const { GroupRow, TermEditor, RunsCard } = load(
  "./sections/Synonyms.jsx",
  sectionDeps
);
test("질문 후보는 횟수·가린 예시를 표시하고 마지막 요약에는 직원 질문 후보 개수를 표시", () => {
  const group = {
    id: 1,
    terms: ["산포도", "산소포화도"],
    kind: "procedure",
    status: "needs_review",
    source: "auto",
    suggestion: {
      status: "pending",
      sources: [
        {
          type: "staff_questions",
          count: 3,
          example: "김○지님은 산포도 확인",
          pages: [],
        },
      ],
    },
  };
  const html = renderToStaticMarkup(
    React.createElement(GroupRow, { group, groups: [group] })
  );
  assert.match(html, /직원 질문에서 · 3회/);
  assert.match(html, /김○지님은 산포도 확인/);
  assert.doesNotMatch(html, /원문 ↗/);
  const runs = renderToStaticMarkup(
    React.createElement(RunsCard, {
      runs: [
        {
          id: 1,
          status: "done",
          summary: { staffQuestions: 2 },
          documents: [],
        },
      ],
    })
  );
  assert.match(runs, /직원 질문에서 2개/);
});
test("직원 질문 후보 설정은 접힌 상세 영역에 하루 한도와 중단 상태를 표시", () => {
  const { QuestionSettings } = load("./sections/Synonyms.jsx", sectionDeps);
  assert.equal(typeof QuestionSettings, "function");
  const html = renderToStaticMarkup(
    React.createElement(QuestionSettings, {
      settings: {
        limit: 20,
        calls: 4,
        status: "running",
        day: "2026-10-12",
        disabled: true,
      },
    })
  );
  assert.match(html, /직원 질문 후보 설정/);
  assert.match(html, /하루 AI 호출 상한/);
  assert.match(html, /value="20"/);
  assert.match(html, /4회/);
  assert.match(html, /시험 환경에서 자동 실행이 차단/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});
test("기존 묶음에 더하는 질문 후보에도 자기 횟수와 예시를 표시", () => {
  const group = {
    id: 1,
    terms: ["반코마이신", "vancomycin"],
    kind: "drug",
    status: "active",
    source: "draft",
    pendingAdditions: [
      {
        id: 2,
        terms: ["반코"],
        status: "pending",
        sources: [
          {
            type: "staff_questions",
            count: 4,
            example: "반코 확인",
            pages: [],
          },
        ],
      },
    ],
  };
  const html = renderToStaticMarkup(
    React.createElement(GroupRow, { group, groups: [group] })
  );
  assert.match(html, /제안 반코 추가/);
  assert.match(html, /직원 질문에서 · 4회/);
  assert.match(html, /반코 확인/);
});

test("자동 생성은 날짜별 한 줄 요약과 접힌 기록이며 실패하면 이유·쪽·재시도를 펼친다", () => {
  const run = {
    id: 77,
    startedAt: "2026-10-12T03:00:00Z",
    trigger: "upload",
    status: "done",
    summary: { newGroups: 2, additions: 3, failed: 0 },
    documents: [{ documentId: "one", status: "done" }],
  };
  const renderRuns = (item) =>
    renderToStaticMarkup(React.createElement(RunsCard, { runs: [item] }));
  const normal = renderRuns(run);
  assert.match(normal, /마지막 AI 후보 찾기:/);
  assert.match(normal, /문서 1개.*새 제안 5개.*실패 0/);
  assert.match(normal, /기록 보기 ›/);
  assert.doesNotMatch(normal, /<details[^>]*open|#77/);
  const failed = renderRuns({
    ...run,
    summary: { failed: 1 },
    documents: [
      {
        documentId: "fake",
        documentName: "가짜.pdf",
        status: "failed",
        error: "timeout",
        retryVersion: 1,
        retryable: true,
        batches: [
          { index: 1, pages: [7, 8], status: "failed", retryable: true },
        ],
      },
    ],
  });
  assert.match(failed, /<details[^>]*open/);
  assert.match(failed, /응답이 늦어/);
  assert.match(failed, /7, 8쪽/);
  assert.match(failed, /실패한 부분 다시 시도|전체 실패 다시 시도/);
  assert.doesNotMatch(failed, /timeout|#77/);
  const legacy = renderRuns({
    ...run,
    summary: { failed: 1 },
    documents: [{ documentName: "과거.pdf", status: "failed" }],
  });
  assert.match(legacy, /과거 기록.*다시 시도할 수 없/);
});

test("재시도 버튼은 선택한 실패 범위만 보내고 대기 중 중복 클릭을 막으며 서버 실패를 알린다", async () => {
  const slots = [];
  let cursor = 0;
  let release;
  const requests = [];
  let reloads = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] = value;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ||= { current: initial });
    },
  };
  const { RunsCard: Card } = load(
    "./sections/Synonyms.jsx",
    {
      ...sectionDeps,
      react: hooks,
      "@/models/schatSynonyms": {
        retryRun: async (id, targets) => {
          requests.push({ id, targets });
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    },
    { Event, window: { dispatchEvent() {} } }
  );
  const props = {
    runs: [
      {
        id: 41,
        status: "done",
        documents: [
          {
            documentId: "fake-doc",
            documentName: "가짜.pdf",
            status: "failed",
            retryVersion: 1,
            retryable: true,
            batches: [
              { index: 2, pages: [6], status: "failed", retryable: true },
            ],
          },
        ],
      },
    ],
    onRetried: async () => {
      reloads++;
    },
  };
  const draw = () => {
    cursor = 0;
    return Card(props);
  };
  const nodes = (tree) =>
    !React.isValidElement(tree)
      ? []
      : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
  const button = nodes(draw()).find(
    (node) => node.props.children === "실패한 부분 다시 시도"
  );
  const pending = button.props.onClick();
  await button.props.onClick();
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {
    id: 41,
    targets: [{ documentId: "fake-doc", batchIndices: [2] }],
  });
  assert.ok(
    nodes(draw())
      .filter((node) => node.type === ui.Button)
      .every((node) => node.props.disabled)
  );
  release({ ok: false, error: "가짜 저장 실패" });
  await pending;
  assert.equal(reloads, 1);
  assert.ok(
    nodes(draw()).some(
      (node) =>
        node.type === ui.Notice && node.props.children === "가짜 저장 실패"
    )
  );
});
function render(change = {}, props = {}) {
  const group = {
    id: 1,
    terms: ["관", "tube"],
    kind: "procedure",
    source: "draft",
    status: "active",
    ...change,
  };
  return renderToStaticMarkup(
    React.createElement(GroupRow, {
      group,
      groups: [group],
      disabled: false,
      editingElsewhere: false,
      ...props,
    })
  );
}

test("단어는 읽기 전용이고 검토 대기도 별도 수정 버튼으로 편집한다", () => {
  assert.match(render(), /<tr/);
  assert.match(render(), /synonym-chip/);
  assert.match(render(), /type="checkbox"[^>]*disabled=""/);
  const draft = render({ status: "needs_review" });
  assert.match(draft, /검토 대기/);
  assert.match(draft, />등록</);
  assert.match(draft, />제외</);
  assert.match(draft, />수정</);
  assert.doesNotMatch(draft, /<button[^>]*class="synonym-chip/);
  assert.match(draft, /synonym-chip--procedure/);
  assert.match(render({ kind: "drug" }), /synonym-kind--drug[^>]*>약물/);
  assert.doesNotMatch(draft, /type="checkbox"[^>]*disabled=""/);
  assert.match(render({ status: "off" }), /사용 안 함/);
});

test("표의 기본 작업은 수정이고 다른 행 편집 중에는 비활성이다", () => {
  assert.match(render(), /synonym-kind--procedure[^>]*>용어/);
  assert.match(render(), />수정</);
  assert.doesNotMatch(render(), /role="switch"/);
  const locked = render({}, { editingElsewhere: true });
  assert.match(locked, /<button[^>]*disabled=""[^>]*>수정</);
});

test("모바일용 항목 이름과 직접 등록 출처를 유지하고 편집기에서만 사용 상태와 삭제를 제공한다", () => {
  const html = render();
  for (const label of ["선택", "동의어", "분류", "상태", "작업"])
    assert.ok(html.includes(`data-label="${label}"`), label);
  assert.doesNotMatch(html, /data-label="출처"|직접 등록|synonym-source-link/);
  const editor = renderToStaticMarkup(
    React.createElement(TermEditor, {
      terms: ["관", "tube"],
      kind: "procedure",
      status: "off",
      onRemove() {},
      error: "단어를 2개 이상 넣어 주세요.",
    })
  );
  assert.match(editor, /role="switch"[^>]*aria-checked="false"/);
  assert.match(editor, /aria-label="관 삭제"/);
  assert.match(editor, /aria-label="추가할 단어"/);
  assert.match(editor, /role="alert"/);
  assert.match(editor, />묶음 삭제</);
  assert.match(editor, />저장</);
});

test("검토 대기 편집은 저장 후 등록이라고 표시하고 안전한 원문만 열 수 있다", () => {
  const editor = renderToStaticMarkup(
    React.createElement(TermEditor, {
      terms: [],
      kind: "drug",
      status: "needs_review",
      pending: true,
    })
  );
  assert.match(editor, />저장 후 등록</);
  const safe = render({
    status: "needs_review",
    source: "auto",
    suggestion: {
      id: 6,
      status: "pending",
      reason: "가짜 근거",
      sources: [
        {
          documentName: "synthetic.pdf",
          pages: [7],
          originalPdfAvailable: true,
          workspaceSlug: "synthetic",
          pdfRef: "a".repeat(43),
        },
      ],
    },
  });
  assert.match(safe, /원문 ↗/);
  assert.doesNotMatch(safe, /원문을 열 수 없는/);
});

test("사용 중인 묶음의 추가 제안은 출처와 내부 표식을 표시하지 않는다", () => {
  const html = render({
    pendingAdditions: [
      {
        id: 8,
        terms: ["catheter"],
        status: "pending",
        sourceMissing: true,
        lowConfidence: true,
        test: true,
        reason: "테스트 근거",
        sources: [{ documentName: "missing.pdf", pages: [2], missing: true }],
      },
    ],
  });
  for (const value of ["제안 catheter 추가", "무시"])
    assert.ok(html.includes(value), value);
  assert.match(html, /synonym-proposal-chip/);
  // 기본 줄에는 출처를 보이지 않고, 접힌 "확인할 내용 보기" 안에서만 보여줌
  const details =
    html.match(
      /<details class="synonym-candidate-details"[\s\S]*?<\/details>/
    )?.[0] || "";
  assert.ok(details, "확인할 내용 보기");
  const row = html.replace(details, "");
  assert.doesNotMatch(
    row,
    /검증용|missing.pdf|테스트 근거|synonym-source-link/
  );
  assert.doesNotMatch(html, /제안 정보|추가 후보/);
  assert.match(details, /missing\.pdf p\.2 \(삭제된 문서\)/);
  assert.match(details, /테스트 근거/);
  assert.match(details, /낮음 · 꼭 확인/);
  assert.match(details, /사용 승인/);
  assert.match(details, /거절/);
});

function loadedSynonyms(selected = [], notice = null) {
  // 서버 렌더링은 비동기 목록 읽기를 실행하지 않으므로 첫 상태에 빈 목록만 공급한다.
  // 나머지 hooks와 실제 화면/하위 구성요소는 React 그대로 렌더링한다.
  let stateIndex = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = stateIndex++;
      const value =
        index === 0
          ? []
          : index === 2
            ? selected
            : index === 11
              ? notice
              : initial;
      return React.useState(value);
    },
  };
  return load("./sections/Synonyms.jsx", {
    ...sectionDeps,
    react: hooks,
  }).default;
}

function renderAdmin(sectionKey, SynonymsSection = loadedSynonyms()) {
  const deps = {
    "react-router-dom": {
      Link: ({ children }) => React.createElement("a", null, children),
      useNavigate: () => () => {},
      useParams: () => ({ section: sectionKey }),
    },
    "react-device-detect": { isMobile: false },
    "@/components/SettingsSidebar": () => null,
    "@/models/workspace": {},
    "@/utils/constants": { LAST_VISITED_WORKSPACE: "test" },
    "@/utils/request": { safeJsonParse: JSON.parse },
    "@/utils/paths": { home: () => "/", settings: { schatAdmin: () => "/" } },
    "./menu": {
      SCHAT_ADMIN_SECTIONS: [],
      SCHAT_ADMIN_TITLE: "SCHAT 관리자 설정",
      findSchatAdminSection,
    },
    "./ui": ui,
    "./uiHelp.css": {},
    "./GeminiAvailabilityBanner": () =>
      React.createElement("aside", null, "가짜 공지"),
  };
  for (const name of [
    "Brand",
    "Answer",
    "AnswerCache",
    "Chunks",
    "Users",
    "Reports",
    "Quiz",
    "Checklists",
    "UsageStats",
    "Status",
    "Storage",
  ])
    deps[`./sections/${name}`] = () => null;
  deps["./sections/Synonyms"] = SynonymsSection;
  const { default: SchatAdmin } = load("./index.jsx", deps);
  return renderToStaticMarkup(React.createElement(SchatAdmin));
}

test("상단 성공 안내는 공간을 차지하지 않고 실패 안내는 유지한다", () => {
  const success = renderAdmin(
    "synonyms",
    loadedSynonyms([], { error: false, text: "저장했어요." })
  );
  assert.doesNotMatch(success, /저장했어요\.|role="status"/);
  const failure = renderAdmin(
    "synonyms",
    loadedSynonyms([], { error: true, text: "저장하지 못했어요." })
  );
  assert.match(failure, /role="alert"/);
  assert.match(failure, /저장하지 못했어요\./);
});

test("실제 동의어 관리 화면은 제목과 안내를 한 번만 표시하고 넓은 표 영역을 쓴다", () => {
  const section = findSchatAdminSection("synonyms");
  const html = renderAdmin("synonyms");
  assert.equal((html.match(/>동의어 관리</g) || []).length, 1);
  const description =
    "같은 뜻의 말을 묶어 두면, 어떤 말로 물어도 지침을 잘 찾아요.";
  assert.equal(section.description, description);
  assert.equal(html.split(description).length - 1, 1);
  assert.match(html, /max-w-\[1180px\]/);
  assert.match(html, /<table[^>]*aria-label="동의어 관리 표"/);
  for (const label of [
    "분류 전체",
    "문서 전체",
    "사용 안 함",
    "동의어",
    "작업",
  ])
    assert.ok(html.includes(label), label);
});

test("새 묶음은 제목·안내 블록과 같은 제목 영역에 있다", () => {
  const html = renderAdmin("synonyms", loadedSynonyms([1]));
  const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
  assert.ok(header, "동의어 제목 영역이 있어야 한다");
  assert.match(header, /<h1[^>]*>동의어 관리<\/h1>/);
  assert.match(header, /\+ 새 묶음 추가/);
});

test("선택 작업은 검색·분류·문서와 같은 도구 줄에 있다", () => {
  const html = renderAdmin("synonyms", loadedSynonyms([1]));
  assert.match(
    html,
    /class="synonym-toolbar"[^>]*><div class="synonym-filters"[\s\S]*?aria-label="단어로 찾기"[\s\S]*?aria-label="분류 전체"[\s\S]*?aria-label="문서 전체"[\s\S]*?<\/select><\/div><div class="synonym-selection"[\s\S]*?묶음으로 등록[\s\S]*?선택 해제/
  );
});

test("다른 관리 화면은 공통 제목·설명과 공지 위치를 유지한다", () => {
  for (const key of ["brand", "answer", "users", "usage"]) {
    const section = findSchatAdminSection(key);
    const html = renderAdmin(key);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, key);
    assert.ok(html.includes(`>${section.label}</h1>`), key);
    assert.ok(html.includes(section.description), key);
    assert.ok(html.indexOf("가짜 공지") < html.indexOf("<header"), key);
    assert.doesNotMatch(html, /synonym-management/, key);
  }
});

test("분류 수정 저장 후 등록만 실패해 편집행이 필터 밖으로 사라져도 화면 조작 잠금이 풀린다", async () => {
  // 실제 화면과 행의 hooks/처리기를 실행하고 외부 모델 경계만 가짜 자료로 대체한다.
  const instances = new Map();
  let current;
  let cursor;
  const hooks = {
    ...React,
    useState(initial) {
      const instance = current;
      const index = cursor++;
      if (!(index in instance.slots)) instance.slots[index] = initial;
      return [
        instance.slots[index],
        (next) => {
          instance.slots[index] =
            typeof next === "function" ? next(instance.slots[index]) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (current.slots[index] ||= { current: initial });
    },
    useMemo(callback) {
      return callback();
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = current.slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => !Object.is(value, previous[i]))
      ) {
        current.slots[index] = dependencies;
        current.effects.push(callback);
      }
    },
  };
  function draw(key, component, props) {
    if (!instances.has(key)) instances.set(key, { slots: [], effects: [] });
    current = instances.get(key);
    cursor = 0;
    current.effects = [];
    const tree = component(props);
    for (const callback of current.effects) callback();
    return tree;
  }
  function nodes(tree) {
    return !React.isValidElement(tree)
      ? []
      : [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)];
  }
  function byLabel(tree, label) {
    return nodes(tree).find((node) => node.props["aria-label"] === label);
  }
  const original = {
    id: 9,
    terms: ["생검", "biopsy"],
    kind: "procedure",
    source: "auto",
    status: "needs_review",
    suggestion: { id: 91, status: "pending" },
  };
  let stored = { ...original };
  const otherGroups = Array.from({ length: 21 }, (_, index) => ({
    id: 100 + index,
    terms: [`약${index}`, `drug${index}`],
    kind: "drug",
    source: "admin",
    status: "off",
  }));
  const api = {
    list: async () => [{ ...stored }, ...otherGroups],
    runs: async () => [],
    questionSettings: async () => ({
      ok: true,
      settings: { limit: 20, calls: 0 },
    }),
    update: async (id, change) => {
      assert.equal(id, 9);
      stored = { ...stored, ...change };
      return { ok: true, success: true };
    },
    approveAddition: async (id) => {
      assert.equal(id, 91);
      return { ok: false, success: false, error: "가짜 승인 실패" };
    },
  };
  const module = load("./sections/Synonyms.jsx", {
    ...sectionDeps,
    react: hooks,
    "@/models/schatSynonyms": api,
  });
  const drawSection = () => draw("section", module.default);
  drawSection();
  await setImmediate();
  let tree = drawSection();
  nodes(tree)
    .find(
      (node) =>
        node.props["aria-pressed"] !== undefined &&
        node.props.children[0] === "검토 대기"
    )
    .props.onClick();
  tree = drawSection();
  byLabel(tree, "분류 전체").props.onChange({ target: { value: "procedure" } });
  tree = drawSection();
  const rowElement = nodes(tree).find((node) => node.type === module.GroupRow);
  let row = draw("row9", module.GroupRow, rowElement.props);
  nodes(row)
    .find((node) => node.type === "button" && node.props.children === "수정")
    .props.onClick();
  tree = drawSection();
  assert.equal(byLabel(tree, "분류 전체").props.disabled, true);
  row = draw(
    "row9",
    module.GroupRow,
    nodes(tree).find((node) => node.type === module.GroupRow).props
  );
  let editor = nodes(row).find((node) => node.type === module.TermEditor);
  editor.props.setKind("drug");
  row = draw(
    "row9",
    module.GroupRow,
    nodes(tree).find((node) => node.type === module.GroupRow).props
  );
  editor = nodes(row).find((node) => node.type === module.TermEditor);
  await editor.props.onSave(["생검", "biopsy"]);
  tree = drawSection();
  tree = drawSection(); // 효과가 편집 잠금을 해제한 뒤의 실제 화면 상태.
  assert.equal(stored.kind, "drug");
  assert.equal(stored.status, "needs_review");
  assert.equal(
    nodes(tree).some((node) => node.type === module.GroupRow),
    false
  );
  assert.equal(byLabel(tree, "분류 전체").props.disabled, false);
  assert.equal(byLabel(tree, "다음 페이지").props.disabled, true); // 현재 결과가 빈 한 페이지.
  const newButton = nodes(tree).find(
    (node) => node.props.children === "+ 새 묶음 추가"
  );
  assert.equal(newButton.props.disabled, false);
  const failure = nodes(tree).find((node) => node.props.role === "alert");
  assert.match(
    failure.props.children.props.children,
    /수정 내용은 저장.*등록에 실패/
  );
  byLabel(tree, "분류 전체").props.onChange({ target: { value: "drug" } });
  tree = drawSection();
  assert.equal(
    nodes(tree).some((node) => node.type === module.GroupRow),
    true
  );
  assert.equal(byLabel(tree, "분류 전체").props.disabled, false);
  nodes(tree)
    .find(
      (node) =>
        node.props["aria-pressed"] !== undefined &&
        node.props.children[0] === "전체"
    )
    .props.onClick();
  tree = drawSection();
  assert.equal(byLabel(tree, "다음 페이지").props.disabled, false);
  byLabel(tree, "다음 페이지").props.onClick();
  tree = drawSection();
  assert.equal(byLabel(tree, "2페이지").props["aria-current"], "page");
  newButton.props.onClick();
  tree = drawSection();
  assert.equal(
    nodes(tree).some((node) => node.props["data-synonym-creating"]),
    true
  );
});
