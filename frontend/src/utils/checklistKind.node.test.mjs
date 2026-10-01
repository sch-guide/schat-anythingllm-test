import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { checklistKindChoice, checklistKindOptions, checklistKindSummary } from "./checklistKind.js";
import { matchChecklists } from "./checklistMatcher.js";
const require = createRequire(import.meta.url);
const { createChecklistRepository } = require("../../../server/utils/documentChecklists/repository.js");
const { toPublicChecklist } = require("../../../server/utils/documentChecklists/presenter.js");
const source = readFileSync(new URL("../pages/SchatAdmin/sections/Checklists.jsx", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("export const CHECKLIST_STATUS_LABELS"), source.indexOf("const FILTERS"));
const { filterChecklists, checklistDocumentLabel } = await import(`data:text/javascript,${encodeURIComponent(helpers)}`);

test("administrator can choose each category or automatic while seeing its original result", () => {
  const source = { kind: "procedure", autoKind: "surgery", adminKind: "procedure" };
  assert.equal(checklistKindChoice(source), "procedure");
  assert.deepEqual(checklistKindOptions(source).map(o => o.value), ["auto", "procedure", "surgery", "other"]);
  assert.match(checklistKindOptions(source)[0].label, /수술/);
  assert.match(checklistKindSummary(source), /검사 및 시술.*관리자 지정.*수술/);
  assert.equal(checklistKindChoice({ kind: "surgery", autoKind: "surgery" }), "auto");
});

test("saving and reloading a category moves the card between filters without changing staff content", () => {
  const root = mkdtempSync(path.join(tmpdir(), "schat-kind-ui-"));
  let repository = createChecklistRepository({storageRoot:root});
  repository.saveAutoChecklist({id:"kind-ui",documentId:"synthetic",page:63,title:"가상 인터벤션",aliases:["가상 인터벤션"],source:{filename:"가상자료.pdf",page:63},sections:[
    {id:"before",title:"수술 전",items:[{id:"one",type:"checkable",label:"가상 확인",details:[]}]},
    {id:"after",title:"수술 후",items:[{id:"two",type:"checkable",label:"가상 관찰",details:[]}]}]});
  const original = repository.getById("kind-ui");
  for (const status of ["needs_review", "active", "hidden"]) {
    repository.setStatus("kind-ui", status);
    for (const kind of ["procedure", "surgery", "other", null]) {
      repository.setKind("kind-ui",kind);
      repository = createChecklistRepository({storageRoot:root});
      const saved = repository.getById("kind-ui");
      const card = toPublicChecklist(saved);
      assert.equal(card.source.kind,kind || "surgery");
      assert.equal(card.source.autoKind,"surgery");
      assert.equal(card.status,status);
      for (const field of ["title","aliases","sections","source","documentId","page"])
        assert.deepEqual(saved[field],original[field]);
      assert.equal(filterChecklists([card],{status,documentKind:kind || "surgery"}).length,1);
      assert.equal(filterChecklists([card],{status:status==="active"?"hidden":"active",documentKind:"all"}).length,0);
      assert.equal(checklistDocumentLabel(card),({procedure:"검사 및 시술",surgery:"수술",other:"기타"})[kind||"surgery"]);
      const staffBefore = matchChecklists("가상 인터벤션",[toPublicChecklist({...original,status,active:status==="active"})]).map(c=>c.id);
      assert.deepEqual(matchChecklists("가상 인터벤션",[card]).map(c=>c.id),staffBefore);
    }
  }
});
