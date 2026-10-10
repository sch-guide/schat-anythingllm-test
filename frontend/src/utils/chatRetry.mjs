import {resetAdmission} from './chatAdmissionDisplay.mjs';

export function retryableTimeout(history = []) {
  const start = history.findLastIndex(item => item?.role === 'user');
  return start >= 0 && history.slice(start + 1).some(item =>
    ['SCHAT_QUEUE_TIMEOUT', 'SCHAT_GENERATION_TIMEOUT'].includes(item?.errorCode));
}
export function retryQuestion(history = []) {
  const index = history.findLastIndex(item => item?.role === 'user');
  const question = history[index];
  if (!question?.content) return null;
  return {text: question.content, autoSubmit: true, history: resetAdmission(history.slice(0, index + 1)),
    attachments: question.attachments || []};
}
