import { jsonSchema, tool } from 'ai';
import type { AssistantToolTraceEvent, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { RequestUserInput, UserInputForm } from '../runtime/userInput';
import { userInputAnswerError } from '../runtime/userInput';
import { AgentStoppedError } from '../agent-core';

export const USER_INPUT_INSTRUCTIONS = `When a material ambiguity requires the user's choice, call ask_user with concise questions and explicit options instead of ending with a plain-text numbered questionnaire. Use one choice group per decision, and multiple=true only for independent selections. The UI always allows a custom answer. Never preselect or invent consent. Do not ask the user to reconfirm an already explicit paper/goal or expand to unrelated papers. For a proposed outline, include previewMarkdown with the actual outline, not just a promise of a preview. For a requested note with a clear target, read evidence and create a note_propose_create/patch proposal for the existing review UI; do not ask a redundant 'shall I create it?' first. Questionnaire answers specify intent, NOT write approval. After answering, all writes still require the original verified proposal/approval flow. Preserve valid inline [Sx] citations in preview content. This UI tool cannot expand tool permissions or bypass the frozen scope.`;

export function createUserInputTool(request: RequestUserInput, sources: () => ConversationSourceLink[], event: (event: AssistantToolTraceEvent) => void) {
  return tool({
    description: 'Ask the user to resolve 1–3 necessary decisions using selectable options and optional Markdown outline preview. Waits for explicit submission. Does not create, modify or approve anything.',
    inputSchema: jsonSchema<UserInputForm>({
      type: 'object', additionalProperties: false, required: ['title', 'questions'], properties: {
        title: { type: 'string', minLength: 1, maxLength: 160 },
        previewMarkdown: { type: 'string', maxLength: 30000 },
        questions: { type: 'array', minItems: 1, maxItems: 3, items: {
          type: 'object', additionalProperties: false, required: ['id', 'title', 'multiple', 'options'], properties: {
            id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
            title: { type: 'string', minLength: 1, maxLength: 500 }, multiple: { type: 'boolean' },
            options: { type: 'array', minItems: 1, maxItems: 8, items: {
              type: 'object', additionalProperties: false, required: ['id', 'label'], properties: {
                id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' },
                label: { type: 'string', minLength: 1, maxLength: 300 }, description: { type: 'string', maxLength: 1000 }
              }
            } }
          }
        } }
      }
    }),
    execute: async (input, { toolCallId, abortSignal }) => {
      if (new Set(input.questions.map(question => question.id)).size !== input.questions.length ||
        input.questions.some(question => new Set(question.options.map(option => option.id)).size !== question.options.length)) {
        throw new Error('Question and option IDs must be unique.');
      }
      event({ id: toolCallId, toolName: 'ask_user', status: 'running', input, summary: '等待你的选择' });
      const answers = await request({ ...input, toolCallId, sources: sources() }, abortSignal);
      const error = userInputAnswerError(input, answers);
      if (error) throw new AgentStoppedError(error);
      const resolved = input.questions.map(question => ({ question: question.title,
        selected: question.options.filter(option => answers[question.id].selected.includes(option.id)).map(option => option.label),
        text: answers[question.id].text.trim() }));
      event({ id: toolCallId, toolName: 'ask_user', status: 'done', input,
        summary: resolved.map(answer => `${answer.question}：${[...answer.selected, answer.text].filter(Boolean).join('；')}`).join('\n') });
      return { answers: resolved, writeApproved: false };
    }
  });
}
