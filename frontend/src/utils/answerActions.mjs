// A null user represents the existing single-user owner. Server authorization
// independently verifies the stored user and mode on every write request.
export function canManageAnswers(user) {
  return user === null || user?.role === "admin";
}

export function canEditMessage(user, role) {
  return role === "user" || (role === "assistant" && canManageAnswers(user));
}

export async function regenerateAnswer({
  user,
  history,
  chatId,
  isLoading = false,
  deleteChats,
  sendCommand,
}) {
  if (isLoading) return false;
  const filteredHistory = history.slice(0, -1);
  const question = filteredHistory.findLast(
    (message) => message.role === "user"
  );
  if (!question?.content) return false;
  const command = {
    text: question.content,
    autoSubmit: true,
    attachments: question.attachments,
  };
  if (canManageAnswers(user)) {
    await deleteChats(chatId);
    command.history = filteredHistory;
  }
  await sendCommand(command);
  return true;
}

export async function submitEditedQuestion({
  user,
  history,
  chatId,
  editedMessage,
  attachments,
  deleteEditedChats,
  sendCommand,
}) {
  const index = history.findIndex(
    (message) => message.chatId === chatId && message.role === "user"
  );
  if (index < 0 || !editedMessage) return false;
  const command = { text: editedMessage, autoSubmit: true, attachments };
  if (canManageAnswers(user)) {
    command.history = history
      .slice(0, index + 1)
      .map((message, position) =>
        position === index ? { ...message, content: editedMessage } : message
      );
    await deleteEditedChats(chatId);
  }
  await sendCommand(command);
  return true;
}
