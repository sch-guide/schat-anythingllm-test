import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentUpdateBatch } from "./documentUpdateBatch.js";
import { runUploadCompletionSync } from "./uploadBatch.js";

test("새로고침이 예외 대신 실패 결과를 반환해도 실패로 알린다", async () => {
  assert.deepEqual(await runUploadCompletionSync({ onUploadComplete: async () => ({ success: false, folders: [], docpaths: [] }) }), { ok: false });
});

test("화면을 닫은 뒤 도착한 사전 확인 결과는 업로드를 시작하지 않는다", async () => {
  let resolve;
  const { batch, uploaded } = setup(() => new Promise((done) => { resolve = done; }));
  const pending = batch.prepare(items);
  batch.invalidate();
  resolve({ success: true, conflicts: [] });
  await pending;
  assert.equal(uploaded.length, 0);
});

const items = [{ file: { name: "기존.pdf" } }, { file: { name: "신규.pdf" } }];
const conflicts = [
  {
    name: "기존.pdf",
    documents: [{ docpath: "test/old.json", documentId: "old" }],
  },
];
test("파일 읽기 도중 화면을 닫으면 늦은 prepare 호출도 차단한다", async () => {
  const { batch, uploaded, states } = setup(async () => ({ success: true, conflicts: [] }));
  let resolve;
  const reading = new Promise((done) => { resolve = done; });
  const dropped = reading.then((files) => batch.prepare(files));
  batch.invalidate();
  resolve(items);
  assert.equal(await dropped, false);
  assert.equal(uploaded.length, 0);
  assert.equal(states.length, 0);
});
test("작업 공간 변경과 효과 재설정 후 새 묶음만 사용할 수 있다", async () => {
  const old = setup(async () => ({ success: true, conflicts: [] }));
  old.batch.invalidate();
  const current = setup(async () => ({ success: true, conflicts: [] }));
  assert.equal(await old.batch.prepare(items), false);
  assert.equal(await current.batch.prepare(items), true);
  assert.equal(old.uploaded.length, 0);
  assert.equal(current.uploaded.length, 1);
});
function setup(preview) {
  const uploaded = [],
    replacements = [],
    states = [];
  const batch = createDocumentUpdateBatch({
    preview,
    upload: (files) => uploaded.push(files),
    replace: async (files, snapshot) => {
      replacements.push({ files, snapshot });
      return { success: true, relatedItems: {} };
    },
    onState: (state) => states.push(state),
  });
  return { batch, uploaded, replacements, states };
}
test("사전 확인이 끝나기 전에는 파일을 올리지 않는다", async () => {
  let resolve;
  const check = new Promise((done) => {
    resolve = done;
  });
  const { batch, uploaded } = setup(() => check);
  const pending = batch.prepare(items);
  assert.equal(uploaded.length, 0);
  resolve({ success: true, conflicts: [] });
  await pending;
  assert.deepEqual(uploaded, [items]);
});
test("혼합 묶음을 취소하면 신규 파일도 올리지 않는다", async () => {
  const { batch, uploaded, replacements, states } = setup(async () => ({
    success: true,
    conflicts,
  }));
  await batch.prepare(items);
  assert.deepEqual(states.at(-1).conflicts, conflicts);
  batch.cancel();
  await batch.confirm();
  assert.equal(uploaded.length, 0);
  assert.equal(replacements.length, 0);
});
test("확인한 전체 묶음은 교체 전용 요청으로 한 번만 보낸다", async () => {
  const { batch, uploaded, replacements } = setup(async (names) => {
    assert.deepEqual(names, ["기존.pdf", "신규.pdf"]);
    return { success: true, conflicts };
  });
  await batch.prepare(items);
  await Promise.all([batch.confirm(), batch.confirm()]);
  assert.equal(uploaded.length, 0);
  assert.deepEqual(replacements, [{ files: items, snapshot: conflicts }]);
});
for (const response of [
  { success: false },
  { success: true },
  { success: true, conflicts: [{}] },
]) {
  test(`사전 확인 응답 손상 시 중단 ${JSON.stringify(response)}`, async () => {
    const { batch, uploaded, states } = setup(async () => response);
    await batch.prepare(items);
    assert.equal(uploaded.length, 0);
    assert.equal(states.at(-1).phase, "error");
  });
}
test("교체 요청 실패 후 일반 업로드로 우회하지 않는다", async () => {
  let uploads = 0;
  const states = [];
  const batch = createDocumentUpdateBatch({
    preview: async () => ({ success: true, conflicts }),
    upload: () => uploads++,
    replace: async () => {
      throw new Error("교체 실패");
    },
    onState: (state) => states.push(state),
  });
  await batch.prepare(items);
  await batch.confirm();
  assert.equal(uploads, 0);
  assert.equal(states.at(-1).phase, "error");
});
