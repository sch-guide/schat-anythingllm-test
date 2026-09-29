const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  COMMON_NAMES,
  searchAliasesFor,
  splitAlias,
} = require("../../../utils/documentChecklists/commonNames");
const {
  toPublicChecklist,
} = require("../../../utils/documentChecklists/presenter");

test("everyday names are added only to the checklist that owns the key", () => {
  const ptnb = {
    aliases: ["경피적 폐세침 조직검사", "PTNB", "Percutaneous needle biopsy"],
  };
  const extra = searchAliasesFor(ptnb);
  assert.ok(extra.includes("폐생검"));
  assert.ok(extra.includes("경피적 폐생검"));
  // the checklist's own aliases are not repeated
  assert.equal(extra.includes("PTNB"), false);
  // a checklist without a matching key gets nothing
  assert.deepEqual(searchAliasesFor({ aliases: ["가상 검사"] }), []);
});

test("an alias holding two names is split into both names", () => {
  assert.deepEqual(splitAlias("Thrombectomy, Thrombolysis"), [
    "Thrombectomy",
    "Thrombolysis",
  ]);
  assert.deepEqual(splitAlias("PTNB"), []);
  const extra = searchAliasesFor({
    aliases: ["혈전제거술", "Thrombectomy, Thrombolysis"],
  });
  assert.ok(extra.includes("Thrombectomy"));
  assert.ok(extra.includes("Thrombolysis"));
});

test("ambiguous everyday words are never used as search names", () => {
  const all = COMMON_NAMES.flatMap((entry) => entry.names).map((name) =>
    name.toLowerCase()
  );
  for (const word of ["emr", "lp", "pacemaker", "피크", "ct", "esd"])
    assert.equal(all.includes(word), false, word);
});

test("the public checklist carries search names without changing its aliases", () => {
  const checklist = {
    id: "c1",
    documentId: "doc",
    title: "가상 PTNB",
    aliases: ["PTNB"],
    sections: [],
    status: "active",
    active: true,
    source: { filename: "가상.pdf", page: 15 },
  };
  const shown = toPublicChecklist(checklist, {
    originalStorageRoot: fs.mkdtempSync(path.join(os.tmpdir(), "schat-")),
  });
  assert.deepEqual(shown.aliases, ["PTNB"]);
  assert.ok(shown.searchAliases.includes("폐생검"));
});
