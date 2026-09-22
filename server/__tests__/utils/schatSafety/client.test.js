const { createSafetyClient } = require("../../../utils/schatSafety/client");

describe("SCHAT safety evaluator client", () => {
  test("calls prepare exactly once and returns a valid contract", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        contract_id: "abc",
        generation_prompt: "prompt",
        source_units: [{ source_unit_id: "su001" }],
        fallback: { text: "safe", sources: [] },
      }),
    });
    const client = createSafetyClient({
      baseUrl: "http://safety:8001",
      timeoutMs: 100,
      fetchImpl,
    });

    const result = await client.prepare({ request_id: "r1" });

    expect(result.contract_id).toBe("abc");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("times out without retry", async () => {
    const fetchImpl = jest.fn((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const client = createSafetyClient({
      baseUrl: "http://safety:8001",
      timeoutMs: 5,
      fetchImpl,
    });

    await expect(client.prepare({ request_id: "r1" })).rejects.toMatchObject({
      code: "safety_evaluator_timeout",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("rejects malformed response without retry", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    });
    const client = createSafetyClient({
      baseUrl: "http://safety:8001",
      timeoutMs: 100,
      fetchImpl,
    });

    await expect(client.prepare({ request_id: "r1" })).rejects.toMatchObject({
      code: "safety_evaluator_response",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
