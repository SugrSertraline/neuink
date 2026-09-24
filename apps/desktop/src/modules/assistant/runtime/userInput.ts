import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { AgentStoppedError } from '../agent-core';

export type UserInputQuestion = {
  id: string; title: string; multiple: boolean;
  options: Array<{ id: string; label: string; description?: string }>;
};
export type UserInputForm = { title: string; questions: UserInputQuestion[]; previewMarkdown?: string };
export type UserInputAnswers = Record<string, { selected: string[]; text: string }>;
export type UserInputRequest = UserInputForm & { toolCallId: string; sources: ConversationSourceLink[] };
export type RequestUserInput = (request: UserInputRequest, signal?: AbortSignal) => Promise<UserInputAnswers>;
export type PendingUserInput = UserInputRequest & {
  id: string; root: string; conversationId: string; draft: UserInputAnswers;
};

// A running conversation owns its question and draft, not the currently mounted panel.
let snapshot: readonly PendingUserInput[] = [];
const listeners = new Set<() => void>();
const pending = new Map<string, { submit: (answers: UserInputAnswers) => void; cancel: () => void }>();
const publish = () => listeners.forEach(listener => listener());
export const getUserInputs = () => snapshot;
export const subscribeUserInputs = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function userInputAnswerError(form: UserInputForm, answers: UserInputAnswers): string | null {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return '请回答所有问题后继续。';
  if (Object.keys(answers).some(id => !form.questions.some(question => question.id === id))) return '回答包含未知问题。';
  for (const question of form.questions) {
    const answer = Object.prototype.hasOwnProperty.call(answers, question.id) ? answers[question.id] : undefined;
    if (!answer || !Array.isArray(answer.selected) || typeof answer.text !== 'string') return '请回答所有问题后继续。';
    if (answer.text.length > 4000 || new Set(answer.selected).size !== answer.selected.length ||
      (!question.multiple && answer.selected.length > 1) ||
      answer.selected.some(id => !question.options.some(option => option.id === id))) return '选项无效，请重新选择。';
    if (!answer.selected.length && !answer.text.trim()) return '每个问题至少选择一项或填写自己的回答。';
  }
  return null;
}

export function updateUserInputDraft(id: string, draft: UserInputAnswers) {
  snapshot = snapshot.map(item => item.id === id ? { ...item, draft: structuredClone(draft) } : item);
  publish();
}
export function submitUserInput(id: string): string | null {
  const item = snapshot.find(value => value.id === id);
  if (!item || !pending.has(id)) return '这个问题已结束，请查看当前任务。';
  const error = userInputAnswerError(item, item.draft);
  if (error) return error;
  pending.get(id)!.submit(structuredClone(item.draft));
  return null;
}
export function cancelUserInput(id: string) { pending.get(id)?.cancel(); }

export function requestUserInput(root: string, conversationId: string): RequestUserInput {
  return (request, signal) => {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (answers?: UserInputAnswers) => {
        if (!pending.delete(id)) return;
        signal?.removeEventListener('abort', cancel);
        snapshot = snapshot.filter(item => item.id !== id);
        publish();
        if (answers) resolve(answers);
        else reject(signal?.reason ?? new AgentStoppedError('已取消回答，任务停止；未批准任何修改。'));
      };
      const cancel = () => finish();
      pending.set(id, { submit: finish, cancel });
      signal?.addEventListener('abort', cancel, { once: true });
      snapshot = [...snapshot, { ...structuredClone(request), id, root, conversationId, draft: {} }];
      publish();
    });
  };
}
