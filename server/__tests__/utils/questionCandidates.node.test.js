const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
let api = {};
try {
  api = require("../../utils/synonyms/questionCandidates");
} catch {}

test("검색 실패와 못 찾음의 같은 대화는 한 번, 서로 다른 질문에서 두 번 나온 표현만 수집", () => {
  assert.equal(typeof api.collectExpressions, "function");
  const rows = [
    { id: 1, prompt: "산포도 산포도 알려줘", response: '{"sources":[]}' },
    {
      id: 1,
      prompt: "산포도 산포도 알려줘",
      response: '{"sources":[]}',
      notFound: true,
    },
    {
      id: 2,
      prompt: "산포도는 어떻게 확인해?",
      response: '{"sources":[{}]}',
      notFound: true,
    },
    { id: 3, prompt: "반코 알려줘", response: '{"sources":[]}' },
    { id: 4, prompt: "반코 알려줘", response: '{"sources":[{}]}' },
  ];
  const result = api.collectExpressions(rows);
  assert.equal(result.find((x) => x.term === "산포도").count, 2);
  assert.equal(
    result.some((x) => x.term === "반코"),
    false
  );
});

test("후보 입력에는 이름·번호·병실·메모를 넣지 않고 표시용 예시도 가림", () => {
  assert.equal(typeof api.collectExpressions, "function");
  const rows = [1, 2].map((id) => ({
    id,
    prompt: "김민지님 612호 12345678 산포도 확인",
    response: '{"sources":[]}',
    memo: "비밀메모",
  }));
  const result = api.collectExpressions(rows);
  assert.ok(result.some((x) => x.term === "산포도"));
  const json = JSON.stringify(result);
  for (const privateText of ["김민지", "12345678", "612호", "비밀메모"])
    assert.equal(json.includes(privateText), false);
});
test("이름 뒤 님·환자분의 호칭 변형은 예시와 전송 표현에서 제외", () => {
  for (const prompt of [
    "김민지님이요 산포도",
    "김민지 환자분은 산포도",
    "홍길동님이라고 산포도",
    "이영희 환자분께서는 산포도",
  ]) {
    const result = api.collectExpressions(
      [1, 2].map((id) => ({ id, prompt, response: '{"sources":[]}' }))
    );
    assert.deepEqual(
      result.map((item) => item.term),
      ["산포도"]
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /김민지|홍길동|이영희|님이요|환자분/
    );
    assert.doesNotMatch(api.safeExample(prompt), /김민지|홍길동|이영희/);
  }
  assert.equal(
    api.safeExample("산소포화도 환자는 유지"),
    "산소포화도 환자는 유지"
  );
  assert.equal(api.safeExample("혈액투석 환자는 유지"), "혈액투석 환자는 유지");
});

test("AI가 입력 밖의 용어를 만들거나 이미 거절한 말을 다른 묶음으로 제안하면 버림", () => {
  assert.equal(typeof api.checkMatches, "function");
  const expressions = [{ term: "산포도", count: 2, example: "산포도 확인" }];
  const snippets = [{ text: "산소포화도 SpO2", page: 5, documentId: "fake" }];
  const matches = [
    { term: "산포도", target: "산소포화도", category: "용어", confidence: 0.9 },
    { term: "반코", target: "반코마이신", category: "약물", confidence: 1 },
    { term: "산포도", target: "없는 용어", category: "용어", confidence: 1 },
  ];
  assert.equal(api.checkMatches(matches, expressions, snippets, []).length, 1);
  assert.deepEqual(
    api.checkMatches(matches, expressions, snippets, ["산포도"]),
    []
  );
});
test("알 수 없는 분류와 가려지지 않은 5자리 번호는 후보 입력·출력에서 제외", () => {
  const expressions = api.collectExpressions(
    [1, 2].map((id) => ({
      id,
      prompt: "김민지님은 12345 산포도 확인",
      response: '{"sources":[]}',
    }))
  );
  assert.equal(JSON.stringify(expressions).includes("12345"), false);
  assert.deepEqual(
    api.checkMatches(
      [
        {
          term: "산포도",
          target: "산소포화도",
          category: "기타",
          confidence: 1,
        },
      ],
      expressions,
      [{ text: "산소포화도 SpO2" }],
      []
    ),
    []
  );
});

function ledger(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(
    "CREATE TABLE system_settings(label TEXT PRIMARY KEY, value TEXT)"
  );
  const db = {
    system_settings: {
      findUnique: async ({ where }) =>
        sqlite
          .prepare("SELECT * FROM system_settings WHERE label=?")
          .get(where.label),
      upsert: async ({ create, update, where }) =>
        sqlite
          .prepare(
            "INSERT INTO system_settings VALUES (?,?) ON CONFLICT(label) DO UPDATE SET value=?"
          )
          .run(where.label, create.value, update.value),
    },
    $transaction: async (fn) => {
      sqlite.exec("BEGIN");
      try {
        const result = await fn(db);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  assert.equal(typeof api.createLedger, "function");
  return { sqlite, db, store: api.createLedger(db) };
}

test("하루 20회 예약 후 추가 호출 차단, 저장소 재생성해도 같은 날 재실행 차단", async (t) => {
  const { db, store } = ledger(t);
  const token = await store.claim("2026-10-12");
  assert.ok(token);
  assert.equal(await api.createLedger(db).claim("2026-10-12"), null);
  for (let i = 0; i < 20; i++)
    assert.equal(await store.reserve("2026-10-12", token), true);
  assert.equal(await store.reserve("2026-10-12", token), false);
  assert.equal((await api.createLedger(db).read()).calls, 20);
  assert.equal(await store.reserve("2026-10-13", token), false);
});

test("0이면 끄기, 잘못된 상한·손상된 기록은 초기화 없이 거절", async (t) => {
  const { sqlite, store } = ledger(t);
  await store.setLimit(0);
  assert.equal(await store.claim("2026-10-12"), null);
  for (const bad of [-1, 1.5, "20", 201])
    await assert.rejects(store.setLimit(bad));
  sqlite.prepare("UPDATE system_settings SET value=?").run("{broken");
  await assert.rejects(store.claim("2026-10-12"));
  assert.equal(
    sqlite.prepare("SELECT value FROM system_settings").get().value,
    "{broken"
  );
});

test("횟수 저장 실패와 잘못된 실행 소유자는 호출 허용을 받지 못함", async (t) => {
  const { db, store } = ledger(t);
  const token = await store.claim("2026-10-12");
  assert.equal(await store.reserve("2026-10-12", "other"), false);
  db.system_settings.upsert = async () => {
    throw new Error("disk full");
  };
  await assert.rejects(store.reserve("2026-10-12", token));
  assert.equal((await store.read()).calls, 0);
});

test("실행기는 호출 직전 예약하고 한도를 넘는 묶음은 보내지 않음", async (t) => {
  const { store } = ledger(t);
  assert.equal(typeof api.runCandidates, "function");
  await store.setLimit(1);
  let calls = 0;
  const saved = [];
  const result = await api.runCandidates({
    ledger: store,
    day: () => "2026-10-12",
    load: async () => ({
      rows: [1, 2].map((id) => ({
        id,
        prompt: "산포도 확인",
        response: '{"sources":[]}',
      })),
      batches: [
        [{ text: "산소포화도 SpO2", page: 2, documentId: "fake" }],
        [{ text: "다른 용어", page: 3, documentId: "fake" }],
      ],
      dismissed: [],
    }),
    ask: async (input) => {
      calls++;
      assert.equal((await store.read()).calls, 1);
      assert.deepEqual(input.terms, ["산포도"]);
      assert.equal(JSON.stringify(input).includes("example"), false);
      return [
        {
          term: "산포도",
          target: "산소포화도",
          category: "용어",
          confidence: 0.9,
        },
      ];
    },
    save: async (matches) => {
      saved.push(...matches);
      return matches.length;
    },
  });
  assert.equal(calls, 1);
  assert.equal(saved.length, 1);
  assert.equal(result.status, "limited");
  assert.equal((await store.read()).candidates, 1);
});

test("실행 중 날짜가 바뀌거나 AI가 실패하면 재전송하지 않으며 예외 원문을 저장하지 않음", async (t) => {
  const { store } = ledger(t);
  assert.equal(typeof api.runCandidates, "function");
  let calls = 0;
  await api.runCandidates({
    ledger: store,
    day: () => "2026-10-12",
    load: async () => ({
      rows: [1, 2].map((id) => ({
        id,
        prompt: "반코 확인",
        response: '{"sources":[]}',
      })),
      batches: [[{ text: "반코마이신" }]],
      dismissed: [],
    }),
    ask: async () => {
      calls++;
      throw new Error("비밀 환자정보");
    },
    save: async () => assert.fail("실패 결과 저장 금지"),
  });
  assert.equal(calls, 1);
  assert.equal((await store.read()).status, "failed");
  assert.equal(JSON.stringify(await store.read()).includes("비밀"), false);
  assert.equal(await store.claim("2026-10-12"), null);
  let today = "2026-10-13";
  await api.runCandidates({
    ledger: store,
    day: () => today,
    load: async () => {
      today = "2026-10-14";
      return {
        rows: [1, 2].map((id) => ({
          id,
          prompt: "반코 확인",
          response: '{"sources":[]}',
        })),
        batches: [[{ text: "반코마이신" }]],
        dismissed: [],
      };
    },
    ask: async () => assert.fail("날짜 경계 뒤 호출 금지"),
    save: async () => 0,
  });
  assert.equal((await store.read()).calls, 0);
});
