import test from "node:test";
import assert from "node:assert/strict";
import {
  createPersonalSession,
  clearLegacyChecklistCopies,
} from "./checklistPersonalSession.js";
test("network payload masks patient name but keeps free memo", async () => {
  let sent;
  const session = createPersonalSession(
    {
      read: async () => null,
      write: async (body) => {
        sent = body;
        return { ...body, revision: "r", expiresAt: Date.now() + 86400000 };
      },
    },
    () => {}
  );
  await session.load();
  session.edit({ patient: "612호 / 홍길동", other: "합성 메모" });
  await session.save();
  assert.equal(sent.patient, "612호 / 홍○동");
  assert.equal(sent.other, "합성 메모");
});
test("기타메모도 이름처럼 보이는 부분만 가려 보내고 간호 용어는 그대로 둔다", async () => {
  let sent;
  let shown;
  const session = createPersonalSession(
    {
      read: async () => null,
      write: async (body) => {
        sent = body;
        return { ...body, revision: "r", expiresAt: Date.now() + 86400000 };
      },
    },
    (next) => (shown = next)
  );
  await session.load();
  session.edit({ patient: "", other: "612호 홍길동 NPO, 낙상 고위험 재평가" });
  await session.save();
  assert.equal(sent.other, "612호 홍○동 NPO, 낙상 고위험 재평가");
  assert.equal(shown.other, "612호 홍○동 NPO, 낙상 고위험 재평가");
});
test("conflict is not retried against a new revision", async () => {
  let writes = 0;
  let state;
  const session = createPersonalSession(
    {
      read: async () => ({
        revision: "r",
        checks: {},
        patient: "",
        other: "",
        expiresAt: Date.now() + 86400000,
      }),
      write: async () => {
        writes++;
        throw Object.assign(Error(), { code: "CONFLICT" });
      },
    },
    (s) => (state = s)
  );
  await session.load();
  session.edit({ other: "합성" });
  await session.save();
  await session.save();
  assert.equal(writes, 1);
  assert.equal(state.error, "CONFLICT");
});
test("logout clears memory and ignores a late read response", async () => {
  let resolve;
  let state;
  const session = createPersonalSession(
    { read: () => new Promise((r) => (resolve = r)) },
    (s) => (state = s)
  );
  const loading = session.load();
  session.dispose();
  resolve({ patient: "private", other: "private" });
  await loading;
  assert.equal(state.patient, "");
  assert.equal(state.other, "");
});
test("legacy cleanup leaves unrelated browser values untouched", () => {
  const data = new Map([
    ["schat_checklist_memo:1:a", "old"],
    ["schat_checklist_checks:1:a", "old"],
    ["theme", "blue"],
  ]);
  const storage = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    removeItem: (k) => data.delete(k),
  };
  clearLegacyChecklistCopies(storage);
  assert.deepEqual([...data], [["theme", "blue"]]);
});
test("late refresh cannot overwrite an edit saved during the request", async () => {
  let resolve,
    state,
    reads = 0;
  const old = {
    revision: "old",
    checks: {},
    patient: "",
    other: "old",
    expiresAt: Date.now() + 86400000,
  };
  const session = createPersonalSession(
    {
      read: () =>
        ++reads === 1
          ? Promise.resolve(old)
          : new Promise((r) => (resolve = r)),
      write: async (b) => ({ ...b, revision: "new", expiresAt: old.expiresAt }),
    },
    (s) => (state = s)
  );
  await session.load();
  const pending = session.load();
  session.edit({ other: "new" });
  await session.save();
  resolve(old);
  await pending;
  assert.equal(state.other, "new");
  assert.equal(state.revision, "new");
});
test("expiry while save waits never restores the old screen copy", async () => {
  let now = 1,
    resolve,
    state;
  const session = createPersonalSession(
    {
      read: async () => ({
        revision: "old",
        checks: {},
        patient: "",
        other: "old",
        expiresAt: 10,
      }),
      write: () => new Promise((r) => (resolve = r)),
    },
    (s) => (state = s),
    () => now
  );
  await session.load();
  session.edit({ other: "new" });
  const pending = session.save();
  now = 10;
  session.expire();
  resolve({
    revision: "new",
    checks: {},
    patient: "",
    other: "new",
    expiresAt: 20,
  });
  await pending;
  assert.equal(state.other, "");
  assert.equal(state.error, "EXPIRED");
});
test("close waits for an in-flight write and drains later edits", async () => {
  let resolve,
    writes = 0,
    state;
  const session = createPersonalSession(
    {
      read: async () => null,
      write: async (b) => {
        writes++;
        if (writes === 1) await new Promise((r) => (resolve = r));
        return {
          ...b,
          revision: String(writes),
          expiresAt: Date.now() + 86400000,
        };
      },
    },
    (s) => (state = s)
  );
  await session.load();
  session.edit({ other: "합성 메모" });
  const pending = session.save();
  session.edit({ other: "" });
  let closed = false;
  const closing = session.close().then(() => (closed = true));
  await Promise.resolve();
  assert.equal(closed, false);
  resolve();
  await pending;
  await closing;
  assert.equal(writes, 2);
  assert.equal(state.other, "");
  assert.equal(state.ready, false);
});
