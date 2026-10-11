const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
let api = {};
try {
  api = require("../../utils/synonyms/questionCandidateService");
} catch {}

function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(`CREATE TABLE workspace_chats(id INTEGER PRIMARY KEY, prompt TEXT, response TEXT, user_id INTEGER, createdAt INTEGER);
    CREATE TABLE schat_answer_feedback(chatId INTEGER, userId INTEGER, feedback INTEGER, reason TEXT, memo TEXT);
    CREATE TABLE schat_synonym_groups(id INTEGER PRIMARY KEY, terms TEXT, status TEXT, source TEXT, kind TEXT, note TEXT);
    CREATE TABLE schat_synonym_suggestions(id INTEGER PRIMARY KEY,type TEXT,group_id INTEGER,terms TEXT,category TEXT,confidence REAL,reason TEXT,method TEXT,sources TEXT,status TEXT,run_id INTEGER,lastUpdatedAt INTEGER);
    CREATE TABLE system_settings(label TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE schat_synonym_suggestion_runs(id INTEGER PRIMARY KEY,trigger TEXT,test INTEGER,status TEXT,summary TEXT,documents TEXT,finishedAt INTEGER);`);
  const table = (name) => ({
    findMany: async () => sql.prepare(`SELECT * FROM ${name}`).all(),
    create: async ({ data }) => {
      const keys = Object.keys(data);
      const { lastInsertRowid } = sql
        .prepare(
          `INSERT INTO ${name} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`
        )
        .run(
          ...Object.values(data).map((v) =>
            typeof v === "boolean" ? Number(v) : v
          )
        );
      return sql
        .prepare(`SELECT * FROM ${name} WHERE id=?`)
        .get(lastInsertRowid);
    },
    update: async ({ where, data }) =>
      sql
        .prepare(
          `UPDATE ${name} SET ${Object.keys(data)
            .map((k) => `${k}=?`)
            .join(",")} WHERE id=?`
        )
        .run(
          ...Object.values(data).map((v) => (v instanceof Date ? +v : v)),
          where.id
        ),
  });
  const db = {
    $queryRawUnsafe: async (q, ...args) => sql.prepare(q).all(...args),
    workspace_documents: { findMany: async () => [{ docpath: "fake-page" }] },
    schat_synonym_groups: table("schat_synonym_groups"),
    schat_synonym_suggestions: table("schat_synonym_suggestions"),
    schat_synonym_suggestion_runs: table("schat_synonym_suggestion_runs"),
    system_settings: {
      findUnique: async ({ where }) =>
        sql
          .prepare("SELECT * FROM system_settings WHERE label=?")
          .get(where.label),
      upsert: async ({ where, create, update }) =>
        sql
          .prepare(
            "INSERT INTO system_settings VALUES (?,?) ON CONFLICT(label) DO UPDATE SET value=?"
          )
          .run(where.label, create.value, update.value),
    },
  };
  db.$transaction = async (fn) => {
    sql.exec("BEGIN");
    try {
      const result = await fn(db);
      sql.exec("COMMIT");
      return result;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  };
  return { sql, db };
}

test("실제 수집 SQL은 최근 직원 질문만 읽고 평가 취소와 종류 변경을 반영하며 메모를 읽지 않음", async (t) => {
  assert.equal(typeof api.loadQuestionData, "function");
  const { sql, db } = fixture(t);
  const now = Date.parse("2026-10-12T18:00:00Z");
  const insert = sql.prepare("INSERT INTO workspace_chats VALUES (?,?,?,?,?)");
  insert.run(1, "산포도 확인", '{"sources":[]}', 1, now);
  insert.run(2, "산포도 확인", '{"sources":[{}]}', 1, now);
  insert.run(3, "옛날말", '{"sources":[]}', 1, now - 8 * 86400000);
  insert.run(4, "익명말", '{"sources":[]}', null, now);
  sql
    .prepare(
      "INSERT INTO schat_answer_feedback VALUES (2,1,0,'not_found','비밀메모')"
    )
    .run();
  const options = {
    now: () => new Date(now),
    loadDocument: async () => ({
      document_id: "fake",
      page: 3,
      pageContent: "산소포화도 SpO2\n김민지 교수 전화 12345678",
    }),
  };
  const loaded = await api.loadQuestionData(db, options);
  assert.deepEqual(
    loaded.rows.map((x) => x.id),
    [2, 1]
  );
  assert.equal(loaded.rows[0].notFound, 1);
  assert.equal(JSON.stringify(loaded).includes("비밀메모"), false);
  assert.equal(JSON.stringify(loaded.batches).includes("김민지"), false);
  assert.equal(loaded.batches[0][0].documentId, "fake");
  sql.exec("UPDATE schat_answer_feedback SET reason='wrong'");
  assert.equal((await api.loadQuestionData(db, options)).rows[0].notFound, 0);
  sql.exec("DELETE FROM schat_answer_feedback");
  assert.equal((await api.loadQuestionData(db, options)).rows[0].notFound, 0);
});

test("기존 저장 경로는 질문마다 다른 출처를 보존하며 새 묶음·추가 후보를 만들고 거절어 재등록을 막음", async (t) => {
  assert.equal(typeof api.saveQuestionMatches, "function");
  const { sql, db } = fixture(t);
  sql.exec(`INSERT INTO schat_synonym_groups VALUES (1,'["반코마이신","vancomycin"]','active','draft','drug',NULL);
    INSERT INTO schat_synonym_suggestions(type,group_id,terms,sources,status) VALUES ('addition',1,'["거절어"]','[]','dismissed')`);
  const candidate = (term, target, count, example) => ({
    terms: [term, target],
    kind: "procedure",
    category: "용어",
    confidence: 0.9,
    pages: [3],
    source: {
      type: "staff_questions",
      count,
      example,
      documentId: "fake",
      pages: [3],
    },
  });
  const saved = await api.saveQuestionMatches(
    db,
    [
      candidate("산포도", "산소포화도", 2, "산포도 확인"),
      candidate("반코", "반코마이신", 4, "반코 확인"),
      candidate("거절어", "새 용어", 5, "거절어 확인"),
    ],
    8
  );
  assert.deepEqual(saved, {
    newGroups: 1,
    additions: 1,
    duplicates: 0,
    excluded: 1,
  });
  const rows = sql
    .prepare("SELECT * FROM schat_synonym_suggestions WHERE status='pending'")
    .all();
  assert.deepEqual(
    rows.map((x) => x.type),
    ["group", "addition"]
  );
  assert.equal(JSON.parse(rows[0].sources)[0].count, 2);
  assert.equal(JSON.parse(rows[1].sources)[0].example, "반코 확인");
  assert.equal(
    sql.prepare("SELECT status FROM schat_synonym_groups WHERE id=2").get()
      .status,
    "needs_review"
  );
  assert.equal(
    sql.prepare("SELECT terms FROM schat_synonym_groups WHERE id=1").get()
      .terms,
    '["반코마이신","vancomycin"]'
  );
});

test("한국 새벽3시만 예약하고 환경에서 끄면 예약과 실행 모두 외부호출 없이 종료", async () => {
  assert.equal(typeof api.installQuestionSchedule, "function");
  const registrations = [];
  let calls = 0;
  const later = {
    parse: {
      cron: (spec) => {
        registrations.push(spec);
        return spec;
      },
    },
    setInterval: (fn) => {
      registrations.push(fn);
      return { clear() {} };
    },
  };
  assert.equal(
    api.installQuestionSchedule(later, {
      env: { SCHAT_QUESTION_SYNONYMS_DISABLED: "true" },
      run: async () => {
        calls++;
      },
    }),
    null
  );
  api.installQuestionSchedule(later, {
    env: {},
    run: async () => {
      calls++;
    },
  });
  assert.equal(registrations[0], "0 18 * * *");
  await registrations[1]();
  assert.equal(calls, 1);
  assert.deepEqual(
    await api.runQuestionCandidates({
      env: { SCHAT_QUESTION_SYNONYMS_DISABLED: "true" },
    }),
    { status: "disabled", candidates: 0 }
  );
});

test("전용 Gemini 경계는 SDK와 요청 재시도를 끄고 오류 원문·임의 응답을 노출하지 않으며 사용량만 전달", async () => {
  assert.equal(typeof api.createQuestionAsker, "function");
  let config, options, body;
  const usage = [];
  class Client {
    constructor(value) {
      config = value;
      this.chat = {
        completions: {
          create: async (request, settings) => {
            body = request;
            options = settings;
            return {
              choices: [
                {
                  message: {
                    content:
                      '{"matches":[{"term":"산포도","target":"산소포화도","category":"용어","confidence":0.9}]}',
                  },
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 20,
                total_tokens: 70,
              },
            };
          },
        },
      };
    }
  }
  const ask = api.createQuestionAsker({
    Client,
    env: {
      GEMINI_API_KEY: "fake-key",
      GEMINI_LLM_MODEL_PREF: "gemini-2.5-flash",
    },
    onUsage: async (value) => usage.push(value),
  });
  const result = await ask({ terms: ["산포도"], lines: ["산소포화도 SpO2"] });
  assert.equal(result[0].target, "산소포화도");
  assert.equal(config.maxRetries, 0);
  assert.equal(options.maxRetries, 0);
  assert.equal(JSON.stringify(body).includes("fake-key"), false);
  assert.equal(usage[0].inputTokens, 50);
  const bad = api.createQuestionAsker({
    env: { GEMINI_API_KEY: "fake", GEMINI_LLM_MODEL_PREF: "gemini-3.8-flash" },
    Client: class {
      constructor() {
        this.chat = {
          completions: {
            create: async () => {
              throw Error("환자 원문 비밀키");
            },
          },
        };
      }
    },
  });
  await assert.rejects(
    bad({ terms: ["산포도"], lines: ["산소포화도"] }),
    /^Error: QUESTION_AI_FAILED$/
  );
});
test("답변용 모델이 명시되지 않으면 임의 기본 모델로 요청하지 않고 안전하게 실패", async () => {
  let creations = 0;
  let requests = 0;
  const ask = api.createQuestionAsker({
    env: { GEMINI_API_KEY: "fake-key" },
    onRequest: async () => {
      requests++;
    },
    Client: class {
      constructor() {
        creations++;
      }
    },
  });
  await assert.rejects(
    ask({ terms: ["산포도"], lines: ["산소포화도"] }),
    /^Error: QUESTION_AI_FAILED$/
  );
  assert.equal(creations, 0);
  assert.equal(requests, 0);
});
test("요청 직전 기록 저장이 실패하면 SDK 요청을 보내지 않음", async () => {
  let requests = 0;
  const ask = api.createQuestionAsker({
    env: { GEMINI_API_KEY: "fake", GEMINI_LLM_MODEL_PREF: "gemini-3.8-flash" },
    onRequest: async () => {
      throw Error("DB failed");
    },
    Client: class {
      constructor() {
        this.chat = {
          completions: {
            create: async () => {
              requests++;
              return { choices: [] };
            },
          },
        };
      }
    },
  });
  await assert.rejects(ask({ terms: ["산포도"], lines: ["산소포화도"] }));
  assert.equal(requests, 0);
});

test("전체 실행은 동시 요청을 막고 실행기 재생성 후 당일 재호출 없이 기존 기록에 출처를 연결", async (t) => {
  const { sql, db } = fixture(t);
  const now = () => new Date("2026-10-12T18:00:00Z");
  for (const id of [1, 2])
    sql
      .prepare("INSERT INTO workspace_chats VALUES (?,?,?,?,?)")
      .run(id, "김민지님은 산포도 확인", '{"sources":[]}', 1, +now());
  let calls = 0;
  const options = {
    prisma: db,
    env: {},
    now,
    loadDocument: async () => ({
      document_id: "fake",
      page: 1,
      pageContent: "산소포화도 SpO2",
    }),
    ask: async (input) => {
      calls++;
      assert.deepEqual(input.terms, ["산포도"]);
      return [
        {
          term: "산포도",
          target: "산소포화도",
          category: "용어",
          confidence: 0.95,
        },
      ];
    },
  };
  const runs = await Promise.all([
    api.runQuestionCandidates(options),
    api.runQuestionCandidates(options),
  ]);
  assert.equal(runs.filter((x) => x.status === "done").length, 1);
  assert.equal(calls, 1);
  assert.equal((await api.runQuestionCandidates(options)).status, "skipped");
  assert.equal(calls, 1);
  const run = sql.prepare("SELECT * FROM schat_synonym_suggestion_runs").get();
  assert.equal(run.trigger, "staff_questions");
  assert.equal(JSON.parse(run.summary).staffQuestions, 1);
  assert.equal(
    sql.prepare("SELECT run_id FROM schat_synonym_suggestions").get().run_id,
    run.id
  );
});

test("직원 질문 출처는 문서 출처와 구별하여 횟수와 가린 예시를 관리자 목록에 유지", async (t) => {
  const { sql, db } = fixture(t);
  sql
    .prepare(
      "INSERT INTO schat_synonym_suggestions(type,group_id,terms,sources,status) VALUES (?,?,?,?,?)"
    )
    .run(
      "group",
      1,
      '["산포도","산소포화도"]',
      JSON.stringify([
        {
          type: "staff_questions",
          count: 3,
          example: "김민지님은 12345678 산포도 확인",
          documentId: "fake",
          pages: [1],
        },
      ]),
      "pending"
    );
  const result =
    await require("../../utils/synonyms/suggestions").withSuggestions(
      [{ id: 1 }],
      db
    );
  const source = result[0].suggestion.sources[0];
  assert.equal(source.type, "staff_questions");
  assert.equal(source.count, 3);
  assert.equal(source.example.includes("김민지"), false);
  assert.equal(source.example.includes("12345678"), false);
});
test("같은 문서라도 질문 출처가 문서 출처를 덮어쓰지 않고 최근 질문 횟수를 갱신", async (t) => {
  const { sql, db } = fixture(t);
  sql.exec(
    `INSERT INTO schat_synonym_groups VALUES (1,'["산포도","산소포화도"]','needs_review','auto','procedure',NULL)`
  );
  sql
    .prepare(
      "INSERT INTO schat_synonym_suggestions(type,group_id,terms,sources,status) VALUES (?,?,?,?,?)"
    )
    .run(
      "group",
      1,
      '["산포도","산소포화도"]',
      JSON.stringify([
        { documentId: "fake", documentName: "합성 지침", pages: [1] },
      ]),
      "pending"
    );
  const candidate = {
    terms: ["산포도", "산소포화도"],
    kind: "procedure",
    pages: [1],
    source: {
      type: "staff_questions",
      count: 3,
      example: "산포도 확인",
      documentId: "fake",
      pages: [1],
    },
  };
  await api.saveQuestionMatches(db, [candidate], 8);
  await api.saveQuestionMatches(
    db,
    [{ ...candidate, source: { ...candidate.source, count: 5 } }],
    9
  );
  const sources = JSON.parse(
    sql.prepare("SELECT sources FROM schat_synonym_suggestions").get().sources
  );
  assert.equal(sources.length, 2);
  assert.equal(sources[0].documentName, "합성 지침");
  assert.equal(sources[1].type, "staff_questions");
  assert.equal(sources[1].count, 5);
});
