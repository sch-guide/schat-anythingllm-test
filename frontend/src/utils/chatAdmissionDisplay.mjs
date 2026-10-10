export function updateAdmission(history, position, now = Date.now()) {
  const rest = history.filter((item) => !item.admission);
  // Keep the admission time on the current question: Agent status entries can
  // be replaced as tools run. Never restart the clock for a repeated event.
  if (position === 0) {
    const index = rest.findLastIndex((item) => item.role === "user");
    if (index >= 0 && !Number.isFinite(rest[index].admissionStartedAt))
      rest[index] = { ...rest[index], admissionStartedAt: now };
  }
  return [
    ...rest,
    {
      type: "statusResponse",
      role: "assistant",
      admission: true,
      position,
      content:
        position > 0 ? `SCHAT 답변 대기 중 · ${position}번째` : "답변 준비 중",
      animate: true,
      pending: false,
      closed: false,
    },
  ];
}
export function generationStartedAt(history = []) {
  const question = history.findLast((item) => item?.role === "user");
  return Number.isFinite(question?.admissionStartedAt)
    ? question.admissionStartedAt
    : null;
}
export function resetAdmission(history = []) {
  const next = history.filter(item => !item.admission);
  const index = next.findLastIndex(item => item?.role === "user");
  if (index >= 0) {
    const {admissionStartedAt, ...question} = next[index];
    next[index] = question;
  }
  return next;
}
export function admissionPosition(history = []) {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--)
    if (history[i]?.role === "user") {
      start = i + 1;
      break;
    }
  const item = history.slice(start).findLast((item) => item.admission);
  return Number.isInteger(item?.position) && item.position > 0
    ? item.position
    : null;
}
