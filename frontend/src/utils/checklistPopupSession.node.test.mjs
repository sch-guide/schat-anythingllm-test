import test from "node:test";
import assert from "node:assert/strict";
import {
  createPopupSession,
  readPopupSnapshot,
  hasSavedPopup,
} from "./checklistPopupSession.js";
const day = 86400000;
test('failed authenticated read followed by logout preserves the browser snapshot', async () => {
 const store=storage();let view;
 store.setItem('x',JSON.stringify({owner:'1',checklist:{id:'a'},checks:{a:true},patient:'홍○동',other:'보존',expiresAt:Date.now()+day}));
 const s=createPopupSession({api:{read:async()=>{throw Object.assign(Error(),{code:'UNAUTHORIZED'})}},notify:v=>view=v,storage:store,key:'x',owner:'1'});
 await s.load();s.detach();assert.equal(view.other,'보존');assert.equal(view.checks.a,true);
});
test("connected popup recovers a conflict with explicit reload", async () => {
  let reads = 0,
    view;
  const s = createPopupSession({
    api: {
      read: async () => {
        reads++;
        return null;
      },
      write: async () => {
        throw Object.assign(Error(), { code: "CONFLICT" });
      },
    },
    notify: (v) => (view = v),
    storage: storage(),
    key: "x",
    owner: "1",
  });
  await s.load();
  s.edit({ other: "합성" });
  await s.save();
  assert.equal(view.error, "CONFLICT");
  await s.reload();
  assert.equal(reads, 2);
  assert.equal(view.error, null);
});
const storage = () => {
  const m = new Map();
  return {
    getItem: (k) => m.get(k) || null,
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
  };
};
// 2026-10-27 사용자 결정으로 예전 방식: 로그아웃 후 별도 창에도 가운데를 가린 이름(홍○동)만 남긴다.
test("logout preserves masked contents across reload and never writes to server again", async () => {
  const store = storage();
  let reads = 0,
    writes = 0,
    view;
  let now = 100;
  const api = {
    read: async () => {
      reads++;
      return {
        checks: { a: true },
        patient: "612호 / 홍○동",
        other: "합성 메모",
        updatedAt: 50,
        expiresAt: 50 + day,
        revision: "1",
      };
    },
    write: async () => {
      writes++;
      throw Error("must not write");
    },
  };
  const s = createPopupSession({
    api,
    notify: (v) => (view = v),
    storage: store,
    key: "test",
    owner: "1",
    clock: () => now,
  });
  s.setChecklist({ id: "a", title: "가짜" });
  await s.load();
  s.edit({ patient: "612호 / 홍길동" });
  s.detach();
  assert.equal(view.patient, "612호 / 홍○동");
  assert.equal(view.localOnly, true);
  s.edit({ other: "다음 직원" });
  await s.save();
  assert.equal(writes, 0);
  const r = createPopupSession({
    api,
    notify: (v) => (view = v),
    storage: store,
    key: "test",
    owner: "2",
    clock: () => now,
  });
  await r.load();
  assert.equal(view.other, "다음 직원");
  assert.equal(view.patient, "612호 / 홍○동");
  assert.equal(view.localOnly, true);
  assert.equal(reads, 1);
  now += day;
  r.expire();
  assert.equal(view.other, "");
  assert.equal(view.patient, "");
  assert.deepEqual(view.checks, {});
});
test("late server response cannot overwrite a detached popup", async () => {
  let finish, view;
  const s = createPopupSession({
    api: { read: () => new Promise((r) => (finish = r)) },
    notify: (v) => (view = v),
    storage: storage(),
    key: "x",
    owner: "1",
  });
  const pending = s.load();
  s.detach();
  finish({ patient: "OLD", expiresAt: Date.now() + day });
  await pending;
  assert.notEqual(view.patient, "OLD");
  assert.equal(view.localOnly, true);
});
test("reload and unchanged edit do not extend expiry; expired browser payload is cleared", async () => {
  const store = storage();
  let now = 100,
    view;
  const s = createPopupSession({
    api: {},
    notify: (v) => (view = v),
    storage: store,
    key: "x",
    owner: null,
    clock: () => now,
  });
  s.edit({ other: "합성" });
  now = 200;
  s.edit({ other: "합성" });
  await s.load();
  assert.equal(view.expiresAt, 100 + day);
  now = 100 + day;
  const r = createPopupSession({
    api: {},
    notify: (v) => (view = v),
    storage: store,
    key: "x",
    owner: "new",
    clock: () => now,
  });
  await r.load();
  assert.equal(view.other, "");
  assert.equal(view.localOnly, true);
  assert.equal(JSON.parse(store.getItem("x")).other, "");
});
test("pending server save cannot change local edits after logout", async () => {
  let finish,
    view,
    writes = 0;
  const store = storage();
  const s = createPopupSession({
    api: {
      read: async () => null,
      write: () => {
        writes++;
        return new Promise((r) => (finish = r));
      },
    },
    notify: (v) => (view = v),
    storage: store,
    key: "x",
    owner: "1",
  });
  await s.load();
  s.edit({ other: "보류중" });
  const pending = s.save();
  s.detach();
  s.edit({ other: "PC 내용" });
  finish({ other: "서버 응답", expiresAt: Date.now() + day });
  await pending;
  await s.load();
  await s.save();
  assert.equal(view.other, "PC 내용");
  assert.equal(writes, 1);
});
test("first render restores detached template without requiring login", async () => {
  const store = storage();
  let now = 100;
  const s = createPopupSession({
    api: { read: async () => null },
    notify: () => {},
    storage: store,
    key: "x",
    owner: "1",
    clock: () => now,
  });
  s.setChecklist({ id: "a", title: "합성 체크리스트" });
  await s.load();
  s.edit({ other: "메모" });
  s.detach();
  const restored = readPopupSnapshot(store, "x", "another", now);
  assert.equal(restored.localOnly, true);
  assert.equal(restored.checklist.title, "합성 체크리스트");
  assert.equal(restored.other, "메모");
});
test("only an existing standalone snapshot bypasses login navigation", () => {
  const store = storage();
  store.setItem(
    "schat_popup_v1:ward:a",
    JSON.stringify({ checklist: { id: "a" }, localOnly: true })
  );
  assert.equal(hasSavedPopup("/workspace/ward/checklist/a", store), true);
  assert.equal(hasSavedPopup("/workspace/ward", store), false);
  assert.equal(hasSavedPopup("/workspace/ward/checklist/b", store), false);
  assert.equal(hasSavedPopup("/workspace/%/checklist/a", store), false);
});
test("storage failure is visible instead of silently claiming persistence", async () => {
  let view;
  const s = createPopupSession({
    api: {},
    notify: (v) => (view = v),
    storage: {
      getItem: () => null,
      setItem: () => {
        throw Error("denied");
      },
    },
    key: "x",
    owner: null,
  });
  s.edit({ other: "합성" });
  assert.equal(view.error, "UNAVAILABLE");
});

// 2026-10-17: 채팅 화면 창에서 적은 이름은 "별도 창으로 열기"를 눌러도 그대로 보인다.
test("별도 창은 채팅 화면 창이 이 PC에 둔 원래 이름을 쓰고, 고친 이름도 함께 남긴다", async () => {
  let shared = { patient: "홍길동", other: "", expiresAt: Date.now() + day };
  const sharedNames = { read: () => shared, write: (v) => (shared = v), clear: () => (shared = null) };
  let view;
  const s = createPopupSession({
    api: {
      read: async () => ({ checks: {}, patient: "홍○동", other: "", updatedAt: 1, expiresAt: Date.now() + day, revision: "1" }),
      write: async (b) => ({ ...b, revision: "2", updatedAt: 2, expiresAt: Date.now() + day }),
    },
    notify: (v) => (view = v),
    storage: storage(),
    key: "p",
    owner: "1",
    sharedNames,
  });
  await s.load();
  assert.equal(view.patient, "홍길동");
  s.edit({ patient: "김철수" });
  assert.equal(shared.patient, "김철수");
});
