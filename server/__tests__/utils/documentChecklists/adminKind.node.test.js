// 자료 분류 관리자 지정(adminKind): the automatic classification stays, an
// administrator can override it per checklist and go back to automatic.
// Synthetic checklists only (placeholder wording, no hospital text).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createChecklistRepository,
  ADMIN_KINDS,
} = require("../../../utils/documentChecklists/repository");
const {
  CHECKLIST_KINDS,
  checklistAutoKind,
  checklistDisplayKind,
  toPublicChecklist,
} = require("../../../utils/documentChecklists/presenter");

const endpointSource = fs.readFileSync(
  path.resolve(__dirname, "../../../endpoints/workspaces.js"),
  "utf8"
);

function tempRepository() {
  return createChecklistRepository({
    storageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "checklist-kind-")),
  });
}

// A surgery-shaped checklist (수술 전 / 수술 후) inside a 검사 및 시술 file,
// like p.63 "뇌동맥류 : 인터벤션" whose automatic classification is 수술.
function surgeryShaped(overrides = {}) {
  return {
    id: "kind-1",
    documentId: "doc-v1",
    page: 63,
    title: "가상 인터벤션",
    aliases: ["가상 인터벤션"],
    templateKind: "surgery",
    source: { filename: "검사 및 시술(26.04.07).pdf", page: 63 },
    sections: [
      {
        id: "before",
        title: "수술 전",
        items: [{ id: "i1", type: "checkable", label: "가상 확인", details: [] }],
      },
      {
        id: "after",
        title: "수술 후",
        items: [{ id: "i2", type: "checkable", label: "가상 관찰", details: [] }],
      },
    ],
    ...overrides,
  };
}

function seed(repository, checklist = surgeryShaped()) {
  repository.saveAutoChecklist(checklist);
  repository.setStatus(checklist.id, "active");
  return repository.getById(checklist.id);
}

test("the server and the presenter offer the same three kinds", () => {
  assert.deepEqual([...ADMIN_KINDS], [...CHECKLIST_KINDS]);
  assert.deepEqual([...ADMIN_KINDS], ["procedure", "surgery", "other"]);
});

test("[1] without an administrator choice the automatic classification is used", () => {
  const repository = tempRepository();
  const saved = seed(repository);
  assert.equal(saved.adminKind, undefined);
  assert.equal(checklistAutoKind(saved), "surgery");
  assert.equal(checklistDisplayKind(saved), "surgery");
  const shown = toPublicChecklist(saved).source;
  assert.equal(shown.kind, "surgery");
  assert.equal(shown.autoKind, "surgery");
  assert.equal(shown.adminKind, null);
});

test("[2][3][4] the administrator choice decides the final kind; the automatic one stays visible", () => {
  for (const kind of ["procedure", "surgery", "other"]) {
    const repository = tempRepository();
    seed(repository);
    const updated = repository.setKind("kind-1", kind);
    const shown = toPublicChecklist(updated).source;
    assert.equal(shown.kind, kind, kind);
    assert.equal(shown.adminKind, kind, kind);
    assert.equal(shown.autoKind, "surgery", kind);
  }
});

test("[5] going back to automatic removes the override", () => {
  const repository = tempRepository();
  seed(repository);
  repository.setKind("kind-1", "procedure");
  const reverted = repository.setKind("kind-1", null);
  assert.equal("adminKind" in reverted, false);
  assert.equal(toPublicChecklist(reverted).source.kind, "surgery");
});

test("[6] the choice is saved in the checklist file and survives a reload", () => {
  const repository = tempRepository();
  seed(repository);
  repository.setKind("kind-1", "procedure");
  const reopened = createChecklistRepository({ storageRoot: repository.storageRoot });
  assert.equal(reopened.getById("kind-1").adminKind, "procedure");
  assert.equal(toPublicChecklist(reopened.getById("kind-1")).source.kind, "procedure");
});

test("[10] only the classification changes: content, names, status and the edited mark stay", () => {
  const repository = tempRepository();
  const before = seed(repository);
  const after = repository.setKind("kind-1", "procedure");
  for (const key of ["title", "aliases", "sections", "status", "active", "documentId", "page", "source"])
    assert.deepEqual(after[key], before[key], key);
  assert.equal(after.editedByAdmin, before.editedByAdmin);
  assert.equal(after.editedByAdmin, false);
  // Later content edits and status changes keep the classification.
  repository.updateChecklist("kind-1", { ...before, title: "가상 인터벤션 수정" });
  repository.setStatus("kind-1", "hidden");
  assert.equal(repository.getById("kind-1").adminKind, "procedure");
});

test("an unknown kind is refused and nothing is written", () => {
  const repository = tempRepository();
  seed(repository);
  assert.throws(() => repository.setKind("kind-1", "operation"), /Invalid checklist kind/);
  assert.equal(repository.getById("kind-1").adminKind, undefined);
  assert.equal(repository.setKind("missing", "procedure"), null);
});

test("[8] a new edition with identical source text carries the administrator's classification", () => {
  const repository = tempRepository();
  seed(repository);
  const previous = repository.setKind("kind-1", "procedure");
  const next = surgeryShaped({ id: "kind-2", documentId: "doc-v2", source: { filename: "검사 및 시술(26.10.01).pdf", page: 64 }, page: 64 });
  const result = repository.saveAutoChecklist(next, {
    versionMatch: { result: "same", previous, previousId: previous.id, previousDocumentId: "doc-v1" },
  });
  assert.equal(result.autoPublished, true);
  assert.equal(result.checklist.adminKind, "procedure");
  assert.equal(toPublicChecklist(result.checklist).source.kind, "procedure");
});

test("[9] a changed new edition does not carry it: automatic classification and review", () => {
  const repository = tempRepository();
  seed(repository);
  const previous = repository.setKind("kind-1", "procedure");
  const changed = surgeryShaped({
    id: "kind-2",
    documentId: "doc-v2",
    page: 64,
    source: { filename: "검사 및 시술(26.10.01).pdf", page: 64 },
    status: "needs_review",
  });
  const result = repository.saveAutoChecklist(changed, {
    versionMatch: { result: "changed", previous, previousId: previous.id, previousDocumentId: "doc-v1" },
  });
  assert.equal(result.checklist.status, "needs_review");
  assert.equal("adminKind" in result.checklist, false);
  assert.equal(toPublicChecklist(result.checklist).source.kind, "surgery");
});

test("a new edition without a matched previous checklist never gets someone else's classification", () => {
  const repository = tempRepository();
  seed(repository);
  repository.setKind("kind-1", "other");
  const other = surgeryShaped({ id: "kind-3", documentId: "doc-v2", title: "다른 가상 시술", aliases: ["다른 가상 시술"], page: 70, source: { filename: "검사 및 시술(26.10.01).pdf", page: 70 } });
  const result = repository.saveAutoChecklist(other, { versionMatch: { result: "new" } });
  assert.equal("adminKind" in result.checklist, false);
  assert.equal(repository.getById("kind-1").adminKind, "other");
});

test("re-extracting the same page with the same content keeps the classification", () => {
  const repository = tempRepository();
  seed(repository);
  repository.setKind("kind-1", "procedure");
  repository.saveAutoChecklist(surgeryShaped());
  assert.equal(repository.getById("kind-1").adminKind, "procedure");
});

test("the classification route is administrator/manager only, checks the workspace and accepts auto", () => {
  assert.match(endpointSource, /"\/workspace\/:slug\/checklists\/:checklistId\/kind"/);
  const route = endpointSource.slice(endpointSource.indexOf('"/workspace/:slug/checklists/:checklistId/kind"'));
  const body = route.slice(0, route.indexOf("app.post("));
  assert.match(body, /flexUserRoleValid\(\[ROLES\.admin, ROLES\.manager\]\)/);
  assert.match(body, /allowedDocumentIds\.has\(checklist\.documentId\)/);
  assert.match(body, /kind === "auto" \? null : kind/);
  assert.match(body, /ChecklistRepository\.setKind/);
  assert.doesNotMatch(body, /updateChecklist|setStatus/);
});
