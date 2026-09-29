const test = require("node:test");
const assert = require("node:assert/strict");

const Synonyms = require("../../../utils/synonyms");
const {
  rankByBm25,
} = require("../../../utils/vectorDbProviders/chroma/schatBm25");

const catheter = { id: 1, terms: ["카테터", "cath", "catheter"] };
const hd = { id: 2, terms: ["HD", "혈액투석", "hemodialysis"] };

test("groups are validated; insertion and removal can never share a group", () => {
  assert.deepEqual(
    Synonyms.validateSynonymGroup({ terms: "카테터, cath, catheter, cath" })
      .terms,
    ["카테터", "cath", "catheter"]
  );
  assert.throws(
    () => Synonyms.validateSynonymGroup({ terms: ["삽입술", "제거술"] }),
    /서로 다른 시술 동작/
  );
  assert.throws(
    () => Synonyms.validateSynonymGroup({ terms: ["insertion", "removal"] }),
    /서로 다른 시술 동작/
  );
  assert.throws(
    () => Synonyms.validateSynonymGroup({ terms: ["하나"] }),
    /2개 이상/
  );
  assert.equal(
    Synonyms.validateSynonymGroup({ terms: ["a", "b"], kind: "drug" }).kind,
    "drug"
  );
  assert.equal(
    Synonyms.validateSynonymGroup({ terms: ["a", "b"], kind: "x" }).kind,
    "procedure"
  );
});

test("drafts contain procedure/device names only and no action conflicts", () => {
  for (const terms of Synonyms.DRAFT_GROUPS) {
    const group = Synonyms.validateSynonymGroup({ terms });
    assert.equal(group.kind, "procedure");
  }
  const all = Synonyms.DRAFT_GROUPS.flat().join(" ");
  assert.doesNotMatch(all, /헤파린|heparin|KCl|인슐린|insulin/i);
});

test("drafts are added once as 'needs review'", async () => {
  const rows = [];
  const settings = new Map();
  const prisma = {
    system_settings: {
      findUnique: async ({ where }) => settings.get(where.label) || null,
      create: async ({ data }) => settings.set(data.label, data) && data,
    },
    schat_synonym_groups: {
      create: async ({ data }) =>
        rows.push({ id: rows.length + 1, ...data }) && data,
      findMany: async () => rows,
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  assert.equal(await Synonyms.ensureDraftGroups(prisma), true);
  assert.equal(await Synonyms.ensureDraftGroups(prisma), false);
  assert.equal(rows.length, Synonyms.DRAFT_GROUPS.length);
  assert.ok(
    rows.every((row) => row.status === "needs_review" && row.source === "draft")
  );
});

const doc = (id, text, page) => ({
  id,
  text,
  metadata: { page },
  corpusPosition: page,
});
const corpus = [
  doc("insert", "HD 투석관 삽입술 HD Catheter Insertion 병동 준비", 59),
  doc("remove", "투석관 제거술 Perm Catheter remove 제거 후 관찰", 60),
  doc("other", "수혈 절차 환자 확인", 117),
];

test("BM25: a synonym group counts as one word; without synonyms nothing changes", () => {
  const plain = rankByBm25("HD 카테터 삽입술", corpus);
  const withGroups = rankByBm25("HD 카테터 삽입술", corpus, {
    synonymGroups: [catheter, hd],
  });
  // "카테터" (Korean) is not in the text: only the synonym "catheter" is
  assert.equal(plain.find((d) => d.id === "insert").bm25Coverage, 2 / 3);
  assert.equal(withGroups.find((d) => d.id === "insert").bm25Coverage, 1);
  assert.equal(withGroups[0].id, "insert");
  // a question whose words have no synonym is scored exactly as before
  assert.deepEqual(
    rankByBm25("수혈 절차", corpus, { synonymGroups: [catheter, hd] }),
    rankByBm25("수혈 절차", corpus)
  );
  // "HD cath" finds the insertion page; the removal page is found for "제거"
  assert.equal(
    rankByBm25("HD cath", corpus, { synonymGroups: [catheter, hd] })[0].id,
    "insert"
  );
  const removal = rankByBm25("HD 카테터 제거", corpus, {
    synonymGroups: [catheter, hd],
  }).find((d) => d.id === "remove");
  assert.equal(removal.bm25Coverage, 2 / 3);
});

test("checklist names get synonym variants (English words as whole words)", () => {
  const variants = Synonyms.synonymNameVariants(
    ["HD 카테터", "HD Catheter Insertion"],
    [catheter]
  );
  assert.ok(variants.includes("HD cath"));
  assert.ok(variants.includes("HD catheter"));
  assert.ok(variants.includes("HD 카테터 Insertion"));
  // "cath" inside "catheter" is not a separate word
  assert.equal(
    Synonyms.synonymNameVariants(["catheterization"], [catheter]).length,
    0
  );
});
