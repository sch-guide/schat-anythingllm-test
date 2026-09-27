const QUESTIONS = [
  "수혈 절차 알려줘",
  "진정 절차 알려줘",
  "비터널형 카테터는 뭐야?",
];

function parseEvents(body = "") {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
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
  if (!username || !password) throw new Error("Employee test account is missing.");

  const origin = "http://127.0.0.1:3001";
  const login = await fetch(`${origin}/api/request-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const session = await login.json();
  if (!session.valid || !session.token) throw new Error("Employee login failed.");
  if (session.user?.role === "admin")
    throw new Error("The configured test account is not an employee account.");

  console.log(
    JSON.stringify({ phase: "login", success: true, role: session.user?.role })
  );
  for (const question of QUESTIONS) {
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
    const completed =
      answerEvent?.type === "textResponse" ? answerEvent.close === true : !!finalEvent;
    if (!response.ok || !answerEvent || !completed)
      throw new Error(`Live question failed: ${question}`);

    const answer = String(answerEvent.textResponse || "");
    const sources = Array.isArray(answerEvent.sources)
      ? answerEvent.sources.map((source) => String(source.title || "")).filter(Boolean)
      : [];
    console.log(
      JSON.stringify({
        phase: "question",
        question,
        eventType: answerEvent.type,
        answer,
        answerLength: answer.length,
        safety: answerEvent.safety || null,
        sources,
        forbiddenVisible: {
          documentMetadata: /document_metadata/i.test(answer),
          svg: /(?:<svg\b|^\s*svg\s*$)/im.test(answer),
          internalId: /(?:chunk_id|document_id|sourceunit|source_unit)/i.test(
            answer
          ),
        },
      })
    );
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ phase: "failed", error: error.message }));
  process.exitCode = 1;
});
