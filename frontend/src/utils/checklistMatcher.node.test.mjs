import test from "node:test";
import assert from "node:assert/strict";
import { matchChecklists, checklistsForStoredAnswer as checklistsForStoredAnswerSync } from "./checklistMatcher.js";

const renalChecklist = {
  id: "renal",
  title: "신장조직검사 Renal biopsy",
  aliases: ["renal biopsy", "renal bx", "신장 조직검사", "신생검"],
};

test("근거 없는 답변은 질문의 진료과가 일치해도 체크리스트를 표시하지 않음", () => {
  const os = { id: "fake-os", aliases: ["정형외과"] };
  for (const content of [
    "등록된 문서에서 확인되지 않습니다.",
    "등록된 병원 문서에서 관련 근거를 찾지 못했습니다.",
    "**등록된 문서에서 확인되지 않습니다.**",
  ]) assert.deepEqual(matchChecklists("정형외과 local block 하 I&D", [os], { content }), []);
});

test("대기·진행·오류 답변은 숨기고 정상 완료 답변은 기존 연결 유지", () => {
  for (const response of [
    { content: "" },
    { content: "준비", pending: true },
    { content: "준비", animate: true },
    { content: "준비", error: true },
    { content: "안내", searchOutcome: { version: 2, status: "not_found" } },
  ]) assert.deepEqual(matchChecklists("신생검 준비", [renalChecklist], response), []);
  for (const response of [
    { content: "준비 사항을 확인하세요." },
    { content: "준비 사항을 확인하세요.", animate: true, closed: true },
  ]) assert.deepEqual(matchChecklists("신생검 준비", [renalChecklist], response), [renalChecklist]);
});

test("approved Renal biopsy aliases match case-insensitively", () => {
  for (const question of [
    "Renal biopsy 준비 알려줘",
    "RENAL BX POST CARE",
    "신장 조직검사 전후 간호 알려줘",
    "신생검 검사 후 간호 알려줘",
  ]) {
    assert.deepEqual(matchChecklists(question, [renalChecklist]), [
      renalChecklist,
    ]);
  }
});

test("unrelated questions do not show the Renal biopsy checklist", () => {
  assert.deepEqual(matchChecklists("수혈 절차 알려줘", [renalChecklist]), []);
  assert.deepEqual(matchChecklists("오늘 날씨 어때?", [renalChecklist]), []);
});

test("only active checklists can match", () => {
  assert.deepEqual(
    matchChecklists("신생검 준비", [{ ...renalChecklist, active: false }]),
    []
  );
});

const ct = { id: "ct", title: "가상 CT", aliases: ["CT"] };
const pft = {
  id: "pft",
  title: "폐기능검사 PFT",
  aliases: ["폐기능검사", "PFT", "Pulmonary function test"],
};
const gfs = { id: "gfs", title: "위내시경 GFS", aliases: ["위내시경", "GFS"] };
const esd = {
  id: "esd",
  title: "위내시경점막하박리술 G-ESD",
  aliases: ["위내시경점막하박리술", "G-ESD"],
};
const pcn = {
  id: "pcn",
  title: "신루설치술 PCN",
  aliases: ["신루설치술", "PCN"],
};

test("short English aliases match only as whole words", () => {
  assert.deepEqual(matchChecklists("CT 검사 전 준비", [ct]), [ct]);
  assert.deepEqual(matchChecklists("ct검사 준비", [ct]), [ct]);
  assert.deepEqual(matchChecklists("doctor contact 방법", [ct]), []);
  assert.deepEqual(matchChecklists("pct 수치", [ct]), []);
  assert.deepEqual(matchChecklists("PFT 결과", [pft, ct]), [pft]);
  assert.deepEqual(matchChecklists("pulmonary function test 준비", [pft]), [
    pft,
  ]);
});

test("Korean names ignore spacing", () => {
  assert.deepEqual(matchChecklists("폐 기능 검사 준비", [pft]), [pft]);
  assert.deepEqual(matchChecklists("신루 설치술 후 관찰", [pcn]), [pcn]);
});

test("a longer procedure name wins over a shorter name inside it", () => {
  assert.deepEqual(matchChecklists("위내시경점막하박리술 준비", [gfs, esd]), [
    esd,
  ]);
  assert.deepEqual(matchChecklists("위내시경 준비", [gfs, esd]), [gfs]);
  assert.deepEqual(
    matchChecklists("Renal biopsy 와 PCN 비교", [renalChecklist, pcn]),
    [renalChecklist, pcn]
  );
});

test("a Korean name inside a longer compound word does not match", () => {
  const venogram = {
    id: "venogram",
    title: "혈관조영술 Venogram",
    aliases: ["혈관조영술", "Venogram"],
  };
  const tfca = {
    id: "tfca",
    title: "디지털 감산 뇌혈관 조영술 : TFCA",
    aliases: ["디지털 감산 뇌혈관 조영술", "TFCA"],
  };
  assert.deepEqual(matchChecklists("뇌혈관조영술 준비", [venogram, tfca]), []);
  assert.deepEqual(
    matchChecklists("TFCA 뇌혈관조영술 준비", [venogram, tfca]),
    [tfca]
  );
  assert.deepEqual(matchChecklists("혈관 조영술 후 관찰", [venogram, tfca]), [
    venogram,
  ]);
  assert.deepEqual(matchChecklists("신장조직검사 후 간호", [renalChecklist]), [
    renalChecklist,
  ]);
});

test("everyday search names find a checklist; unrelated words do not", () => {
  const ptnb = {
    id: "ptnb",
    active: true,
    aliases: ["경피적 폐세침 조직검사", "PTNB"],
    searchAliases: ["경피적 폐생검", "폐생검", "폐 조직검사"],
  };
  for (const question of [
    "폐생검 후 간호 알려줘",
    "경피적 폐생검 준비",
    "폐 조직검사 후 관찰",
    "PTNB 후 간호",
  ])
    assert.deepEqual(
      matchChecklists(question, [ptnb]).map((c) => c.id),
      ["ptnb"],
      question
    );
  assert.deepEqual(matchChecklists("폐렴 간호", [ptnb]), []);
  // search names never change the checklist's own aliases
  assert.deepEqual(ptnb.aliases, ["경피적 폐세침 조직검사", "PTNB"]);
});

test("names found only through search names never open the opposite action", () => {
  const insert = {
    id: "hd-insert",
    active: true,
    title: "HD 투석관 삽입술 (HD Catheter Insertion)",
    aliases: ["투석관 삽입술", "HD Catheter Insertion"],
    searchAliases: ["HD 카테터", "HD cath", "HD 카테터 삽입술"],
  };
  const remove = {
    id: "perm-remove",
    active: true,
    title: "투석관 제거술 Perm Catheter remove",
    aliases: ["투석관 제거술", "Perm Catheter remove"],
    searchAliases: ["카테터 제거술"],
  };
  const ids = (question) =>
    matchChecklists(question, [insert, remove]).map((c) => c.id);
  assert.deepEqual(ids("HD 카테터 삽입술 준비"), ["hd-insert"]);
  assert.deepEqual(ids("HD cath 알려줘"), ["hd-insert"]);
  assert.deepEqual(ids("HD 카테터 알려줘"), ["hd-insert"]);
  assert.deepEqual(ids("HD 카테터 제거 방법"), []);
  assert.deepEqual(ids("카테터 제거술 후 관찰"), ["perm-remove"]);
  // the checklist's own name always works
  assert.deepEqual(ids("투석관 삽입술 제거 전후"), ["hd-insert"]);
});

test("checklist names match whatever the spacing", () => {
  const hd = {
    id: "hd",
    active: true,
    title: "HD 투석관 삽입술",
    aliases: ["투석관 삽입술", "HD Catheter Insertion"],
    searchAliases: ["HD 투석관 삽입술"],
  };
  const gfs = {
    id: "gfs",
    active: true,
    title: "위내시경 GFS",
    aliases: ["위내시경", "GFS"],
  };
  const ids = (q) => matchChecklists(q, [hd, gfs]).map((c) => c.id);
  assert.deepEqual(ids("투석관삽입술 준비"), ["hd"]);
  assert.deepEqual(ids("HD투석관삽입술 후 관찰"), ["hd"]);
  assert.deepEqual(ids("투석관 삽입 술 준비"), ["hd"]);
  assert.deepEqual(ids("위 내시경 전 준비"), ["gfs"]);
});

test("questions about using a device do not open its procedure checklist", () => {
  const picc = {
    id: "picc",
    title: "말초삽입형 중심정맥카테터 PICC",
    aliases: ["PICC", "말초삽입형 중심정맥카테터"],
  };
  const shown = (q) => matchChecklists(q, [picc]).map((c) => c.id);
  for (const question of [
    "MRI는 PICC 사용 가능해?",
    "PICC로 채혈 가능해?",
    "PICC 조영제 주입 돼?",
    "PICC 써도 돼?",
    "PICC에 수액 연결해도 돼?",
    "MRI PICC 가능해?",
    "MRI 찍을 때 PICC 괜찮아?",
    "CT 조영제 PICC로 가능?",
    "PICC 있는 환자 MRI 안전해?",
    "PICC 드레싱 주기",
    "PICC 드레싱 교체 가능해?",
  ])
    assert.deepEqual(shown(question), [], question);
  for (const question of [
    "PICC",
    "PICC 삽입 준비",
    "PICC 시술 후 간호",
    "PICC 동의서",
    "PICC 삽입 후 MRI 사용 가능해?",
    "검사 전 PICC 사용 확인",
    "말초삽입형 중심정맥카테터 체크리스트",
    "PICC 삽입 가능한 시간",
  ])
    assert.deepEqual(shown(question), ["picc"], question);
});

// 2026-10-17: 관리자 '질문별 답변'에서 직원이 체크리스트 버튼을 봤는지 같은 규칙으로 계산.
test("저장된 답변에도 직원 화면과 같은 체크리스트 버튼 판단을 쓴다", async () => {
  const { checklistsForStoredAnswer } = await import("./checklistMatcher.js");
  const lists = [{ id: "a", title: "가상 시술", aliases: ["가상시술"], active: true }];
  const ok = { available: true, text: "가상시술 준비는 다음과 같습니다." };
  assert.deepEqual(checklistsForStoredAnswer("가상시술 준비 알려줘", ok, lists).map((c) => c.id), ["a"]);
  // 근거 없는 답·검색 실패·답변 없음은 버튼이 뜨지 않는다.
  assert.deepEqual(checklistsForStoredAnswer("가상시술 준비 알려줘", { available: true, text: "등록된 문서에서 확인되지 않습니다." }, lists), []);
  assert.deepEqual(checklistsForStoredAnswer("가상시술 준비 알려줘", { ...ok, searchOutcome: { version: 2, status: "not_found" } }, lists), []);
  assert.deepEqual(checklistsForStoredAnswer("가상시술 준비 알려줘", { available: false, text: "" }, lists), []);
  assert.deepEqual(checklistsForStoredAnswer("다른 질문", ok, lists), []);
});

// 2026-10-27: "CAG는 당일수술이야?"는 간호필요도 문서만 인용했는데 CAG 시술 체크리스트가 떴다.
// 답이 인용한 문서가 확인되면, 그 체크리스트 문서를 인용한 답에만 버튼을 띄운다.
test("답이 다른 문서만 인용했으면 시술 이름이 있어도 체크리스트를 띄우지 않는다", () => {
  const cag = {
    id: "cag", title: "가상조영술 ANG", aliases: ["ANG", "가상조영술"], active: true,
    source: { filename: "가상 시술 안내.pdf", page: 66 },
  };
  const quoted = (documentName, quotes) => ({ documentName, page: 1, evidenceQuotes: quotes });
  const answer = (sources) => ({ content: "아닙니다. 해당하지 않습니다.", sources });
  // 평가 문서만 인용: 시술 문서는 검색만 되고 인용되지 않음 → 숨김
  assert.deepEqual(matchChecklists("ANG는 당일수술이야?", [cag], answer([
    quoted("가상 평가 기준.pdf", ["단순 조영술(예. ANG)은 해당 X"]),
    quoted("가상 시술 안내.pdf", []),
  ])), []);
  // 시술 문서를 인용 → 표시
  assert.deepEqual(matchChecklists("ANG 준비 알려줘", [cag], answer([
    quoted("가상 시술 안내.pdf", ["양측 서혜부 면도"]),
  ])), [cag]);
  // 같은 문서의 다른 판(날짜 표시만 다름)을 인용해도 같은 문서로 본다
  assert.deepEqual(matchChecklists("ANG 준비 알려줘", [cag], answer([
    quoted("가상 시술 안내(260306).pdf", ["양측 서혜부 면도"]),
  ])), [cag]);
  // document_name 필드만 있는 출처도 같은 문서로 본다
  assert.deepEqual(matchChecklists("ANG 준비 알려줘", [cag], answer([
    { document_name: "가상 시술 안내.pdf", evidenceQuotes: ["양측 서혜부 면도"] },
  ])), [cag]);
  // 인용 기록이 없는 예전 답·출처 없는 답은 지금처럼 이름으로만 판단
  for (const sources of [undefined, [], [{ documentName: "가상 평가 기준.pdf" }],
    [quoted("가상 평가 기준.pdf", [])]])
    assert.deepEqual(matchChecklists("ANG 준비 알려줘", [cag], answer(sources)), [cag]);
  // 체크리스트에 원본 파일 이름이 없으면 지금처럼 이름으로만 판단
  const noSource = { ...cag, source: undefined };
  assert.deepEqual(matchChecklists("ANG 알려줘", [noSource], answer([
    quoted("가상 평가 기준.pdf", ["단순 조영술(예. ANG)은 해당 X"]),
  ])), [noSource]);
  // 관리자 '질문별 답변'도 같은 규칙
  const stored = { available: true, text: "아닙니다.", sources: [quoted("가상 평가 기준.pdf", ["ANG 해당 X"])] };
  assert.deepEqual(checklistsForStoredAnswerSync("ANG는 당일수술이야?", stored, [cag]), []);
});

// 2026-10-27: "PCI는 당일수술여부에 수술로 입력해?"는 답이 시술 문서도 인용해 버튼이 떴다.
// 간호필요도 입력·평가를 묻는 질문은 준비를 함께 묻지 않으면 띄우지 않는다.
test("간호필요도 입력을 묻는 질문은 시술 이름이 있어도 체크리스트를 띄우지 않는다", () => {
  const pci = { id: "pci", title: "가상중재술 PCX", aliases: ["PCX"], active: true };
  const answer = { content: "네, 수술 실시(코드 1)로 입력합니다." };
  for (const question of ["PCX는 당일수술여부에 수술로 입력해?", "PCX 필요도 당일 수술", "PCX 수술 여부"])
    assert.deepEqual(matchChecklists(question, [pci], answer), [], question);
  for (const question of ["PCX 준비", "PCX 체크리스트", "PCX 시술 전 간호", "PCX 당일 수술 준비물"])
    assert.deepEqual(matchChecklists(question, [pci], answer), [pci], question);
});
