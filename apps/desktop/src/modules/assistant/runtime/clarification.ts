import type { AssistantTaskPlanMissing } from '@/shared/types/assistant';

export class AssistantClarificationRequest extends Error {
  constructor(
    readonly missing: AssistantTaskPlanMissing,
    readonly question: string
  ) {
    super(question);
    this.name = 'AssistantClarificationRequest';
  }
}

export function requestAssistantClarification(
  missing: AssistantTaskPlanMissing,
  question: string
): never {
  throw new AssistantClarificationRequest(missing, question);
}
