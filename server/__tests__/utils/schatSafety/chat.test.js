const { runSafetyGatedCompletion } = require("../../../utils/schatSafety/chat");

const sources = [
  {
    id: "chunk-1",
    documentId: "doc-1",
    title: "수혈간호지침.pdf",
    page: 7,
    section: "수혈 시행 전 확인사항",
    text: "수혈 전 환자와 혈액제제를 반드시 확인한다.",
  },
];

describe("runSafetyGatedCompletion", () => {
  test("does not expose candidate before validation and returns PASS output", async () => {
    const events = [];
    const safetyClient = {
      prepare: jest.fn(async () => ({
        contract_id: "c1",
        generation_prompt: "structured prompt",
        structured_output_schema: {
          type: "object",
          required: ["statements"],
        },
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "fallback", sources: [] },
      })),
      validate: jest.fn(async ({ candidate }) => {
        events.push("validate");
        expect(candidate.statements[0].text).toBe("후보 답변");
        return {
          decision: "PASS",
          retry_count: 0,
          display_output: { kind: "candidate", text: "검증된 답변", sources: [] },
        };
      }),
    };
    const LLMConnector = {
      getChatCompletion: jest.fn(async (_messages, options) => {
        events.push("generate");
        expect(options.responseSchema).toEqual({
          type: "object",
          required: ["statements"],
        });
        return {
          textResponse: JSON.stringify({
            statements: [
              { text: "후보 답변", supporting_source_unit_ids: ["su001"] },
            ],
          }),
          metrics: {},
        };
      }),
    };

    const result = await runSafetyGatedCompletion({
      question: "질문",
      sources,
      LLMConnector,
      safetyClient,
    });

    expect(events).toEqual(["generate", "validate"]);
    expect(result.text).toBe("검증된 답변");
    expect(result.text).not.toContain("후보 답변");
  });

  test("returns fallback when validation service fails and never retries", async () => {
    const safetyClient = {
      prepare: jest.fn(async () => ({
        contract_id: "c1",
        generation_prompt: "prompt",
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "원문 답변", sources: [] },
      })),
      validate: jest.fn(async () => {
        throw Object.assign(new Error("timeout"), { code: "safety_evaluator_timeout" });
      }),
    };
    const LLMConnector = {
      getChatCompletion: jest.fn(async () => ({
        textResponse: '{"statements":[]}',
        metrics: {},
      })),
    };

    const result = await runSafetyGatedCompletion({
      question: "질문",
      sources,
      LLMConnector,
      safetyClient,
    });

    expect(result.text).toBe("원문 답변");
    expect(safetyClient.validate).toHaveBeenCalledTimes(1);
    expect(LLMConnector.getChatCompletion).toHaveBeenCalledTimes(1);
  });

  test("refuses without calling Gemini when prepare fails", async () => {
    const safetyClient = {
      prepare: jest.fn(async () => {
        throw new Error("unavailable");
      }),
      validate: jest.fn(),
    };
    const LLMConnector = { getChatCompletion: jest.fn() };

    const result = await runSafetyGatedCompletion({
      question: "질문",
      sources,
      LLMConnector,
      safetyClient,
    });

    expect(result.text).toBe("근거를 안전하게 확인할 수 없어 답변하지 않습니다.");
    expect(LLMConnector.getChatCompletion).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid JSON", "```json\n{bad}\n```", "candidate_json"],
    ["missing required fields", '{"statements":[{}]}', "candidate_schema"],
    [
      "unexpected fields",
      '{"statements":[{"text":"후보","supporting_source_unit_ids":["su001"],"extra":true}]}',
      "candidate_schema",
    ],
  ])("returns fallback for %s without retry", async (_label, textResponse, errorCode) => {
    const safetyClient = {
      prepare: jest.fn(async () => ({
        contract_id: "c1",
        generation_prompt: "structured prompt",
        structured_output_schema: { type: "object" },
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "원문 답변", sources: [] },
      })),
      validate: jest.fn(),
    };
    const LLMConnector = {
      getChatCompletion: jest.fn(async () => ({ textResponse, metrics: {} })),
    };

    const result = await runSafetyGatedCompletion({
      question: "질문",
      sources,
      LLMConnector,
      safetyClient,
    });

    expect(result.text).toBe("원문 답변");
    expect(result.safety.errorCode).toBe(errorCode);
    expect(LLMConnector.getChatCompletion).toHaveBeenCalledTimes(1);
    expect(safetyClient.validate).not.toHaveBeenCalled();
  });

  test("returns fallback when Python rejects an unknown SourceUnit id", async () => {
    const safetyClient = {
      prepare: jest.fn(async () => ({
        contract_id: "c1",
        generation_prompt: "structured prompt",
        structured_output_schema: { type: "object" },
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "원문 답변", sources: [] },
      })),
      validate: jest.fn(async () => ({
        decision: "FAIL",
        retry_count: 0,
        error_code: "unknown_source_unit",
        display_output: {
          kind: "extractive_fallback",
          text: "원문 답변",
          sources: [],
        },
      })),
    };
    const LLMConnector = {
      getChatCompletion: jest.fn(async () => ({
        textResponse: JSON.stringify({
          statements: [
            { text: "후보", supporting_source_unit_ids: ["su999"] },
          ],
        }),
        metrics: {},
      })),
    };

    const result = await runSafetyGatedCompletion({
      question: "질문",
      sources,
      LLMConnector,
      safetyClient,
    });

    expect(result.text).toBe("원문 답변");
    expect(result.safety.errorCode).toBe("unknown_source_unit");
    expect(safetyClient.validate).toHaveBeenCalledTimes(1);
    expect(LLMConnector.getChatCompletion).toHaveBeenCalledTimes(1);
  });

  test("does not reuse generic descriptions as a section", async () => {
    const safetyClient = {
      prepare: jest.fn(async (payload) => {
        expect(payload.retrieved_chunks[0]).toMatchObject({
          document_name: "SCHAT_.txt",
          section: "",
        });
        return {
          contract_id: "c1",
          generation_prompt: "structured prompt",
          structured_output_schema: { type: "object" },
          source_units: [{ source_unit_id: "su001" }],
          fallback: { text: "원문 답변", sources: [] },
        };
      }),
      validate: jest.fn(async () => ({
        decision: "FAIL",
        retry_count: 0,
        display_output: {
          kind: "extractive_fallback",
          text: "원문 답변",
          sources: [],
        },
      })),
    };
    const LLMConnector = {
      getChatCompletion: jest.fn(async () => ({
        textResponse: JSON.stringify({
          statements: [
            { text: "후보", supporting_source_unit_ids: ["su001"] },
          ],
        }),
        metrics: {},
      })),
    };

    await runSafetyGatedCompletion({
      question: "질문",
      sources: [
        {
          ...sources[0],
          title: "SCHAT_���.txt",
          section: "",
          description: "Unknown",
        },
      ],
      LLMConnector,
      safetyClient,
    });
  });
});
