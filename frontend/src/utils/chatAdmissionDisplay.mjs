export function updateAdmission(history, position) {
  const rest = history.filter((item) => !item.admission);
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
