const {
  buildGeminiChatRequest,
} = require("../../../../utils/AiProviders/gemini");

describe("Gemini SCHAT structured output", () => {
  test("passes the Python JSON schema as a strict response format", () => {
    const schema = {
      type: "object",
      properties: { statements: { type: "array" } },
      required: ["statements"],
      additionalProperties: false,
    };

    const request = buildGeminiChatRequest({
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "prompt" }],
      temperature: 0,
      responseSchema: schema,
    });

    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "schat_controlled_answer",
        strict: true,
        schema,
      },
    });
  });

  test("does not change ordinary chat requests without a schema", () => {
    const request = buildGeminiChatRequest({
      model: "gemini-3.8-flash",
      messages: [],
      temperature: 0.7,
    });

    expect(request).not.toHaveProperty("response_format");
  });
});
