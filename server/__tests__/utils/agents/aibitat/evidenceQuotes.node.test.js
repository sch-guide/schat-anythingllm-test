const test = require("node:test");
const assert = require("node:assert/strict");
const {
  completeWithEvidence,
  evidenceSourceId,
} = require("../../../../utils/agents/aibitat/utils/evidenceQuotes");
const makeSources = () => [
  {
    documentName: "synthetic.pdf",
    page: 1,
    text: "Prepare the test equipment. Observe the test indicator after the procedure.",
  },
  {
    documentName: "synthetic.pdf",
    page: 2,
    text: "This unrelated page must not be boxed.",
  },
];
test("같은 이름·본문의 서로 다른 원본 엑셀은 인용 식별자를 공유하지 않음",()=>{
 const a={documentName:"전화번호부.xlsx",text:"성명: 가나다 | 내선번호: 0123",spreadsheetRef:"first"};
 assert.notEqual(evidenceSourceId(a),evidenceSourceId({...a,spreadsheetRef:"second"}));
});
test("paraphrased answers retain validated verbatim quotes on their own source", async () => {
  const sources = makeSources();
  const quote = "Observe the test indicator after the procedure.";
  const id = evidenceSourceId(sources[0]);
  const raw =
    "Check the indicator after completion.\n<schat_evidence>" +
    JSON.stringify({ quotes: [{ source_id: id, text: quote }] }) +
    "</schat_evidence>";
  const sent = [];
  const provider = {
    stream: async (messages, functions, send) => {
      assert.match(messages[0].content, /schat_evidence/);
      for (const char of raw)
        send("reportStreamEvent", {
          type: "textResponseChunk",
          uuid: "test",
          content: char,
        });
      return { textResponse: raw };
    },
  };
  const result = await completeWithEvidence({
    provider,
    sources,
    messages: [{ role: "system", content: "Test only" }],
    functions: [],
    eventHandler: (t, d) => sent.push(d.content),
  });
  assert.equal(result.textResponse, "Check the indicator after completion.");
  assert.equal(sent.join("").trim(), result.textResponse);
  assert.doesNotMatch(sent.join(""), /schat_evidence|source_id/);
  assert.deepEqual(sources[0].evidenceQuotes, [quote]);
  assert.deepEqual(sources[1].evidenceQuotes, []);
});
test("invented, wrong-source, duplicate and absent quotes never fall back to whole chunks", async () => {
  for (const quotes of [
    [],
    [{ source_id: "wrong", text: "Prepare the test equipment." }],
    [
      {
        source_id: evidenceSourceId(makeSources()[0]),
        text: "Invented original statement.",
      },
    ],
  ]) {
    const sources = makeSources();
    await completeWithEvidence({
      provider: {
        complete: async () => ({
          textResponse:
            "Answer<schat_evidence>" +
            JSON.stringify({ quotes }) +
            "</schat_evidence>",
        }),
      },
      sources,
      messages: [],
      functions: [],
    });
    assert.ok(sources.every((s) => s.evidenceQuotes.length === 0));
  }
  const sources = makeSources();
  const result = await completeWithEvidence({
    provider: {
      complete: async () => ({ textResponse: "Answer<schat_evidence>{broken" }),
    },
    sources,
    messages: [],
    functions: [],
  });
  assert.equal(result.textResponse, "Answer");
  assert.ok(sources.every((s) => s.evidenceQuotes.length === 0));
});
test("tool calls and non-document conversations keep existing behavior", async () => {
  const sources = makeSources();
  const result = await completeWithEvidence({
    provider: { complete: async () => ({ functionCall: { name: "search" } }) },
    sources,
    messages: [],
    functions: [],
  });
  assert.equal(result.functionCall.name, "search");
  assert.ok(sources.every((s) => s.evidenceQuotes === undefined));
});

test("different original PDFs with identical names and text retain distinct evidence IDs", async () => {
 const sources=[{...makeSources()[0],pdfRef:"original-one"},{...makeSources()[0],pdfRef:"original-two"}];
 assert.notEqual(evidenceSourceId(sources[0]),evidenceSourceId(sources[1]));
 const quote="Prepare the test equipment.";
 await completeWithEvidence({provider:{complete:async()=>({textResponse:'Answer<schat_evidence>'+JSON.stringify({quotes:[{source_id:evidenceSourceId(sources[0]),text:quote}]})+'</schat_evidence>'})},sources,messages:[],functions:[]});
 assert.deepEqual(sources[0].evidenceQuotes,[quote]);
 assert.deepEqual(sources[1].evidenceQuotes,[]);
});

test("duplicate objects for the same original source keep their verified quote", async () => {
 const sources=[{...makeSources()[0],pdfRef:"same-original"},{...makeSources()[0],pdfRef:"same-original"}];
 const quote="Prepare the test equipment.";
 await completeWithEvidence({provider:{complete:async()=>({textResponse:'Answer<schat_evidence>'+JSON.stringify({quotes:[{source_id:evidenceSourceId(sources[0]),text:quote}]})+'</schat_evidence>'})},sources,messages:[],functions:[]});
 assert.ok(sources.every(source=>source.evidenceQuotes[0]===quote));
});

test("a truncated evidence frame cannot certify a quote", async () => {
 const sources=makeSources();
 await completeWithEvidence({provider:{complete:async()=>({textResponse:'Answer<schat_evidence>'+JSON.stringify({quotes:[{source_id:evidenceSourceId(sources[0]),text:'Prepare the test equipment.'}]})})},sources,messages:[],functions:[]});
 assert.ok(sources.every(source=>source.evidenceQuotes.length===0));
});
