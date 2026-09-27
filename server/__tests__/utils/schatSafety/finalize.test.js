const { finalizeSafetyDecision } = require("../../../utils/schatSafety/finalize");

const prepared = {
  fallback: {
    text: "원문 기반 안전 답변",
    sources: [{ document_name: "수혈간호지침.pdf", page: 7, section: "확인사항" }],
  },
};

describe("finalizeSafetyDecision", () => {
  test("returns candidate only for an explicit PASS", () => {
    const result = finalizeSafetyDecision({
      prepared,
      validation: {
        decision: "PASS",
        retry_count: 0,
        display_output: { kind: "candidate", text: "검증된 답변", sources: [] },
      },
    });
    expect(result.text).toBe("검증된 답변");
    expect(result.safety.usedFallback).toBe(false);
  });

  test.each([null, {}, { decision: "FAIL" }, { decision: "ERROR" }])(
    "returns the prepared fallback for every non-PASS result",
    (validation) => {
      const result = finalizeSafetyDecision({ prepared, validation });
      expect(result.text).toBe("원문 기반 안전 답변");
      expect(result.sources).toEqual([
        {
          title: "수혈간호지침.pdf · p.7 · 확인사항",
          document_name: "수혈간호지침.pdf",
          page: 7,
          section: "확인사항",
          text: "",
          chunkSource: "",
        },
      ]);
      expect(result.safety.usedFallback).toBe(true);
      expect(JSON.stringify(result.safety)).not.toContain("원문 기반 안전 답변");
    }
  );

  test("formats only available human-readable citation fields", () => {
    const result = finalizeSafetyDecision({
      prepared: {
        fallback: {
          text: "안전 답변",
          sources: [{ document_name: "지침.pdf", page: null, section: "" }],
        },
      },
      validation: { decision: "FAIL", error_code: "number_changed" },
    });

    expect(result.sources[0].title).toBe("지침.pdf");
    expect(result.sources[0]).not.toHaveProperty("chunk_id");
    expect(result.sources[0]).not.toHaveProperty("document_id");
  });

  test("removes replacement characters and hides placeholder section labels", () => {
    const result = finalizeSafetyDecision({
      prepared: {
        fallback: {
          text: "안전 답변",
          sources: [
            {
              document_name: "SCHAT_���.txt",
              page: null,
              section: "Unknown",
            },
          ],
        },
      },
      validation: { decision: "FAIL" },
    });

    expect(result.sources[0].title).toBe("SCHAT_.txt");
    expect(result.sources[0].section).toBe("");
    expect(result.sources[0]).not.toHaveProperty("chunk_id");
    expect(result.sources[0]).not.toHaveProperty("document_id");
  });
});
