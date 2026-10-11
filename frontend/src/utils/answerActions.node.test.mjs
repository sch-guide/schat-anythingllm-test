import test from "node:test";
import assert from "node:assert/strict";
const actions = await import("./answerActions.mjs").catch(() => ({}));
const history = [
  {
    chatId: 11,
    role: "user",
    content: "시험 질문",
    attachments: [{ name: "가짜 첨부" }],
  },
  { chatId: 11, role: "assistant", content: "보존할 답변" },
];
for (const role of ["default", "manager"]) {
  test(`${role} 다시 답변은 원래 기록을 보존하고 질문을 한 번 전송`, async () => {
    assert.equal(typeof actions.regenerateAnswer, "function");
    const records = structuredClone(history),
      sent = [];
    let deleted = 0;
    await actions.regenerateAnswer({
      user: { role },
      history: records,
      chatId: 11,
      deleteChats: async () => {
        deleted++;
        records.pop();
      },
      sendCommand: (data) => sent.push(data),
    });
    assert.equal(deleted, 0);
    assert.deepEqual(records, history);
    assert.deepEqual(sent, [
      {
        text: "시험 질문",
        autoSubmit: true,
        attachments: [{ name: "가짜 첨부" }],
      },
    ]);
  });
  test(`${role} 질문 편집 후 전송은 원래 질문·답변을 보존`, async () => {
    assert.equal(typeof actions.submitEditedQuestion, "function");
    const records = structuredClone(history),
      sent = [];
    let deleted = 0;
    await actions.submitEditedQuestion({
      user: { role },
      history: records,
      chatId: 11,
      editedMessage: "수정 질문",
      attachments: [],
      deleteEditedChats: async () => {
        deleted++;
        records.splice(0);
      },
      sendCommand: (data) => sent.push(data),
    });
    assert.equal(deleted, 0);
    assert.deepEqual(records, history);
    assert.deepEqual(sent, [
      { text: "수정 질문", autoSubmit: true, attachments: [] },
    ]);
  });
  test(`${role} 변조된 답변 편집 이벤트와 알 수 없는 역할을 거절`, () => {
    assert.equal(typeof actions.canEditMessage, "function");
    assert.equal(actions.canEditMessage({ role }, "assistant"), false);
    assert.equal(actions.canEditMessage({ role }, undefined), false);
    assert.equal(actions.canEditMessage({ role }, "user"), true);
  });
}
test("답변 생성 중 재생성은 삭제와 전송 모두 실행하지 않음", async () => {
  assert.equal(typeof actions.regenerateAnswer, "function");
  for (const user of [{ role: "default" }, { role: "admin" }, null]) {
    let calls = 0;
    assert.equal(
      await actions.regenerateAnswer({
        user,
        history,
        chatId: 11,
        isLoading: true,
        deleteChats: async () => {
          calls++;
        },
        sendCommand: () => {
          calls++;
        },
      }),
      false
    );
    assert.equal(calls, 0);
  }
});
test("관리자와 단독 소유자는 기존 삭제 후 재생성과 질문 편집을 유지", async () => {
  assert.equal(typeof actions.regenerateAnswer, "function");
  assert.equal(typeof actions.submitEditedQuestion, "function");
  for (const user of [{ role: "admin" }, null]) {
    const steps = [],
      sent = [];
    await actions.regenerateAnswer({
      user,
      history,
      chatId: 11,
      deleteChats: async () => {
        steps.push("delete");
      },
      sendCommand: (data) => {
        steps.push("send");
        sent.push(data);
      },
    });
    assert.deepEqual(steps, ["delete", "send"]);
    assert.deepEqual(sent[0].history, [history[0]]);
    assert.equal(actions.canEditMessage(user, "assistant"), true);
    let deleted = 0;
    await actions.submitEditedQuestion({
      user,
      history,
      chatId: 11,
      editedMessage: "관리 수정",
      attachments: [],
      deleteEditedChats: async () => {
        deleted++;
      },
      sendCommand: (data) => sent.push(data),
    });
    assert.equal(deleted, 1);
    assert.deepEqual(sent[1].history, [
      { ...history[0], content: "관리 수정" },
    ]);
    assert.deepEqual(history[0].content, "시험 질문");
  }
});
test("질문이 없으면 삭제하지 않음", async () => {
  assert.equal(typeof actions.regenerateAnswer, "function");
  let calls = 0;
  assert.equal(
    await actions.regenerateAnswer({
      user: { role: "default" },
      history: [],
      deleteChats: () => {
        calls++;
      },
      sendCommand: () => {
        calls++;
      },
    }),
    false
  );
  assert.equal(calls, 0);
});
