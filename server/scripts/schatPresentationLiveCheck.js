function parseEvents(body = "") {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      try {
        return JSON.parse(line.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function main() {
  const username = process.env.SCHAT_TEST_EMPLOYEE_USERNAME;
  const password = process.env.SCHAT_TEST_EMPLOYEE_PASSWORD;
  if (!username || !password) throw new Error("missing_test_account");

  const origin = "http://127.0.0.1:3001";
  const login = await fetch(`${origin}/api/request-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const session = await login.json();
  if (!session.valid || !session.token || session.user?.role === "admin")
    throw new Error("employee_login_failed");

  const question = "수혈 절차 쉽게 설명해줘";
  const response = await fetch(
    `${origin}/api/workspace/schat-2026-09-22/stream-chat`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: question, mode: "chat" }),
    }
  );
  const events = parseEvents(await response.text());
  const answerEvent = events.find(
    (event) =>
      ["textResponseChunk", "textResponse"].includes(event.type) &&
      event.textResponse
  );
  const finalEvent = events.find(
    (event) => event.type === "finalizeResponseStream"
  );
  if (
    !response.ok ||
    !answerEvent ||
    (answerEvent.type !== "textResponse" && !finalEvent)
  )
    throw new Error("live_question_failed");

  const result = {
    question,
    answer: answerEvent.textResponse,
    presentation: answerEvent.presentation || null,
    sources: (answerEvent.sources || []).map((source) => source.title || ""),
    safety: answerEvent.safety || null,
  };
  const serialized = JSON.stringify(result);
  console.log(serialized);
  console.log(
    JSON.stringify({
      geminiRequests: 1,
      retry: 0,
      forbidden: {
        sourceUnit: /su\d{3}|source[_ ]?unit/i.test(serialized),
        metadata: /document_metadata|chunk_id|document_id/i.test(serialized),
        svg: /<svg\b/i.test(serialized),
      },
    })
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
