import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The section file imports React components; test its pure helpers by
// loading only the helper part of the source.
const source = readFileSync(
  new URL("./sections/Checklists.jsx", import.meta.url),
  "utf8"
);
const helpers = source.slice(
  source.indexOf("export const CHECKLIST_STATUS_LABELS"),
  source.indexOf("const FILTERS")
);
const moduleUrl = `data:text/javascript,${encodeURIComponent(helpers)}`;
const loadHelpers = () => import(moduleUrl);

const item = (id, status, page, title, aliases = []) => ({
  id,
  status,
  title,
  aliases,
  source: { filename: "가상.pdf", page },
});
const list = [
  item("a", "active", 15, "경피적 폐세침 조직검사 PTNB", ["PTNB"]),
  item("b", "needs_review", 8, "골수검사 BM Bx", ["골수검사"]),
  item("c", "hidden", 2, "컴퓨터 단층 촬영 CT"),
];

test("three statuses with plain Korean labels", async () => {
  const { CHECKLIST_STATUS_LABELS } = await loadHelpers();
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(CHECKLIST_STATUS_LABELS).map(([k, v]) => [k, v.text])
    ),
    { needs_review: "검토 필요", active: "공개", hidden: "숨김" }
  );
});

test("filter by status, name (spacing ignored) or page, sorted by page", async () => {
  const { filterChecklists } = await loadHelpers();
  assert.deepEqual(
    filterChecklists(list).map((c) => c.id),
    ["c", "b", "a"]
  );
  assert.deepEqual(
    filterChecklists(list, { status: "needs_review" }).map((c) => c.id),
    ["b"]
  );
  assert.deepEqual(
    filterChecklists(list, { query: "폐세침조직" }).map((c) => c.id),
    ["a"]
  );
  assert.deepEqual(
    filterChecklists(list, { query: "p.2" }).map((c) => c.id),
    ["c"]
  );
});

test("review reasons are explained in plain words", async () => {
  const { reviewReasonText } = await loadHelpers();
  assert.match(reviewReasonText("nested-layout"), /표가 한 번 더/);
  assert.match(reviewReasonText("unknown-code"), /확인이 필요/);
});

test("the admin section never offers employees non-public checklists", () => {
  assert.match(source, /직원 화면에는 <b>공개<\/b> 상태만/);
  assert.match(source, /window\.confirm/);
});
