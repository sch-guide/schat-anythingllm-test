// Only strip wrappers around known safe messages, never infer quota from text.
const messages = [
  '현재 AI 사용량이 소진되어 답변할 수 없습니다. 지침서 원본을 확인하시고, 관리자에게 문의해 주세요. 간호교육파트 내선번호 : 6741',
  '사용자가 많아 잠시 후 다시 시도해 주세요.',
  'AI 연결에 문제가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.',
];
export function geminiErrorDisplay(error) {
  return typeof error === 'string' ? messages.find(message=>error.includes(message)) || error : error;
}
