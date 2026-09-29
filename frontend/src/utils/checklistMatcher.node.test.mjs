import test from "node:test";
import assert from "node:assert/strict";
import { matchChecklists } from "./checklistMatcher.js";

const renalChecklist = {
  id: "renal",
  title: "신장조직검사 Renal biopsy",
  aliases: ["renal biopsy", "renal bx", "신장 조직검사", "신생검"],
};

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
