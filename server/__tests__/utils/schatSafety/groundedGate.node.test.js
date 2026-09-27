const test = require("node:test");
const assert = require("node:assert/strict");

const { runSchatCompletion } = require("../../../utils/schatSafety/chat");

const sources = [
  {
    id: "chunk-1",
    documentId: "doc-1",
    title: "수혈간호지침.pdf",
    page: 7,
    section: "수혈 시행 전 확인사항",
    text: "수혈 전 환자와 혈액제제를 반드시 확인한다.",
  },
  {
    id: "chunk-2",
    documentId: "doc-1",
    title: "수혈간호지침.pdf",
    page: 8,
    section: "수혈 직전 확인",
    text: "의료인 2인이 환자명과 혈액형을 확인한다.",
  },
];

test("gate OFF publishes structured Gemini output without Python evaluator calls", async () => {
  let geminiCalls = 0;
  let sentPrompt = "";
  const safetyClient = {
    async prepare() {
      throw new Error("Python prepare must not be called");
    },
    async validate() {
      throw new Error("Python validate must not be called");
    },
  };
  const LLMConnector = {
    async getChatCompletion(messages, options) {
      geminiCalls += 1;
      sentPrompt = messages[0].content;
      assert.equal(options.responseSchema.type, "object");
      assert.deepEqual(
        options.responseSchema.properties.items.items.properties.source_ids.items
          .enum,
        ["su001", "su002"]
      );
      return {
        textResponse: JSON.stringify({
          summary: {
            text: "수혈은 사전 확인 후 직전 확인 순으로 진행합니다.",
            source_ids: ["su001", "su002"],
          },
          sections: [
            {
              title: "수혈 전 확인",
              source_ids: ["su001"],
              items: [
                {
                  text: "환자와 혈액제제를 확인합니다.",
                  source_ids: ["su001"],
                },
              ],
            },
            {
              title: "수혈 직전 확인",
              source_ids: ["su002"],
              items: [
                {
                  text: "의료인 2인이 환자명을 확인합니다.",
                  source_ids: ["su002"],
                },
                {
                  text: "의료인 2인이 혈액형을 확인합니다.",
                  source_ids: ["su002"],
                },
              ],
            },
          ],
        }),
        metrics: { total_tokens: 10 },
      };
    },
  };

  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "수혈 절차 알려줘",
    sources,
    LLMConnector,
    safetyClient,
  });

  assert.equal(
    result.text,
    [
      "수혈은 사전 확인 후 직전 확인 순으로 진행합니다.",
      "",
      "1단계. 수혈 전 확인",
      "- 환자와 혈액제제를 확인합니다.",
      "",
      "2단계. 수혈 직전 확인",
      "- 의료인 2인이 환자명을 확인합니다.",
      "- 의료인 2인이 혈액형을 확인합니다.",
    ].join("\n")
  );
  assert.deepEqual(result.presentation, {
    kind: "procedure",
    summary: "수혈은 사전 확인 후 직전 확인 순으로 진행합니다.",
    sections: [
      {
        title: "수혈 전 확인",
        items: [
          {
            text: "환자와 혈액제제를 확인합니다.",
            sourceIndexes: [1],
          },
        ],
      },
      {
        title: "수혈 직전 확인",
        items: [
          {
            text: "의료인 2인이 환자명을 확인합니다.",
            sourceIndexes: [2],
          },
          {
            text: "의료인 2인이 혈액형을 확인합니다.",
            sourceIndexes: [2],
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    result.sources.map((source) => source.title),
    [
      "수혈간호지침.pdf · p.7 · 수혈 시행 전 확인사항",
      "수혈간호지침.pdf · p.8 · 수혈 직전 확인",
    ]
  );
  assert.equal(result.sources[0].documentName, sources[0].title);
  assert.equal(result.sources[0].excerpt, sources[0].text);
  assert.equal(result.sources[0].text, result.sources[0].excerpt);
  assert.equal(result.sources[1].excerpt, sources[1].text);
  assert.doesNotMatch(JSON.stringify(result), /su00\d|document_metadata|<svg/i);
  assert.equal(result.safety, undefined);
  assert.equal(geminiCalls, 1);
  assert.match(sentPrompt, /제공된 SCHAT 근거만 사용/);
  assert.match(sentPrompt, /일반 의학지식, 외부 지식을 추가하지 않습니다/);
  assert.match(sentPrompt, /수혈 전 환자와 혈액제제를 반드시 확인한다/);
});

test("procedure presentation rejects internal identifiers in visible text", async () => {
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "\uC218\uD608 \uC808\uCC28",
    sources,
    LLMConnector: {
      async getChatCompletion() {
        return {
          textResponse: JSON.stringify({
            summary: { text: "Follow su001.", source_ids: ["su001"] },
            sections: [
              {
                title: "Stage",
                source_ids: ["su001"],
                items: [{ text: "Action", source_ids: ["su001"] }],
              },
            ],
          }),
          metrics: {},
        };
      },
    },
  });

  assert.deepEqual(result.sources, []);
  assert.equal(result.presentation, undefined);
  assert.doesNotMatch(JSON.stringify(result), /su001/);
});

test("flat procedure schema is parsed and grouped into public sections", async () => {
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "\uC218\uD608 \uC808\uCC28",
    sources,
    LLMConnector: {
      async getChatCompletion() {
        return {
          textResponse: JSON.stringify({
            summary_text: "Summary",
            summary_source_ids: ["su001", "su002"],
            items: [
              {
                section_title: "First",
                text: "Action one",
                source_ids: ["su001"],
              },
              {
                section_title: "First",
                text: "Action two",
                source_ids: ["su002"],
              },
            ],
          }),
          metrics: {},
        };
      },
    },
  });

  assert.deepEqual(result.presentation, {
    kind: "procedure",
    summary: "Summary",
    sections: [
      {
        title: "First",
        items: [
          { text: "Action one", sourceIndexes: [1] },
          { text: "Action two", sourceIndexes: [2] },
        ],
      },
    ],
  });
});

test("gate OFF refuses before Gemini when usable evidence is empty", async () => {
  let geminiCalls = 0;
  const result = await runSchatCompletion({
    safetyGateEnabled: false,
    question: "비터널형 카테터는 뭐야?",
    sources: [],
    LLMConnector: {
      async getChatCompletion() {
        geminiCalls += 1;
        return null;
      },
    },
  });

  assert.equal(result.text, "근거를 안전하게 확인할 수 없어 답변하지 않습니다.");
  assert.deepEqual(result.sources, []);
  assert.equal(geminiCalls, 0);
});

test("gate OFF rejects malformed JSON and unknown source IDs without fallback", async (t) => {
  const cases = [
    ["malformed JSON", "{not-json"],
    [
      "unknown SourceUnit",
      JSON.stringify({
        statements: [
          {
            text: "근거 없는 답변",
            supporting_source_unit_ids: ["su999"],
          },
        ],
      }),
    ],
  ];

  for (const [name, textResponse] of cases) {
    await t.test(name, async () => {
      const result = await runSchatCompletion({
        safetyGateEnabled: false,
        question: "수혈 절차 알려줘",
        sources,
        LLMConnector: {
          async getChatCompletion() {
            return { textResponse, metrics: {} };
          },
        },
      });

      assert.equal(
        result.text,
        "근거를 안전하게 확인할 수 없어 답변하지 않습니다."
      );
      assert.deepEqual(result.sources, []);
      assert.equal(result.safety, undefined);
    });
  }
});
