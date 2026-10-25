import type { AssistantToolTraceEvent, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { AssistantTaskPlan } from '@/shared/types/assistant';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';
import { paperPresentationError, paperRecords, presentedPaperRecords } from '../research/paperPresentation';
import { citationCorrection, matchedExternalCitationUrls, returnedExternalCitationUrls, taskVerificationCorrection } from './citationContract';
import { hasConfirmedPaperImportOnly } from './researchCompletion';
import { hasAssistantToolMarkup } from './assistantAnswerMarkup';
import { isRawModelToolCall } from './modelToolCallMarkup';

/** The same evidence/completion contract applies to SDK and native Agent answers. */
export function answerVerification({ answer, question, plan, sources, events, observations,
  hasProposals, availabilityNotes, missing = [] }: {
  answer: string; question: string; plan?: AssistantTaskPlan | null;
  sources: Map<number, ConversationSourceLink>; events: AssistantToolTraceEvent[];
  observations: Array<{ toolName: string; output: unknown }>;
  hasProposals: boolean; availabilityNotes: string[]; missing?: string[];
}): { message: string; correction: string } | undefined {
  if (isRawModelToolCall(answer)) return {
    message: ASSISTANT_READ_FAILURES.contract,
    correction: '上一次输出的是原始工具调用标记，不是回答。请根据已有工具结果直接回答用户，并按实际来源添加引用；不要输出 <tool_call> 标记。'
  };
  const records = paperRecords(events.flatMap(event => event.status === 'done' ? event.researchPapers ?? [] : []), [...sources.values()]);
  const presentationError = paperPresentationError(answer, records);
  const toolMarkup = hasAssistantToolMarkup(answer);
  const invalidCitation = [...answer.matchAll(/\[S(\d+)]/g)].some(match => !sources.has(Number(match[1])));
  const externalUrls = returnedExternalCitationUrls(observations);
  const citedExternalSource = matchedExternalCitationUrls(answer, externalUrls, records).length > 0;
  const citedSciversePaper = presentedPaperRecords(answer, records).some(record => record.kind === 'sciverse');
  const evidenceRead = events.some(event => event.status === 'done' && (event.sources?.length ?? 0) > 0);
  const noEvidenceAfterFailure = sources.size === 0 && externalUrls.size === 0 &&
    (availabilityNotes.length > 0 || events.some(event => event.status === 'error'));
  const required = plan?.citationPolicy === 'required' || plan?.capabilities.includes('search_evidence') ||
    ['paper_qa', 'paper_search', 'paper_summary'].includes(plan?.intent ?? '');
  const uncited = !noEvidenceAfterFailure && (required || (plan?.executionMode !== undefined &&
    (evidenceRead || (externalUrls.size > 0 && !hasConfirmedPaperImportOnly(observations))))) &&
    !hasProposals && !citedExternalSource && !citedSciversePaper &&
    ![...answer.matchAll(/\[S(\d+)]/g)].some(match => sources.has(Number(match[1])));
  if (!presentationError && !toolMarkup && !missing.length && !invalidCitation && !uncited && (answer.trim() || hasProposals)) return;
  return {
    message: toolMarkup ? '模型返回了不完整的工具标签，未能形成最终回答。'
      : invalidCitation || uncited ? ASSISTANT_READ_FAILURES.citation : ASSISTANT_READ_FAILURES.contract,
    correction: taskVerificationCorrection(question, [
      presentationError ?? '', toolMarkup ? 'Do not print tool-control tags or partial tool calls. Use only the declared tool API, or give a normal user-facing answer from verified observations.' : '',
      missing.length ? `Call these required tools before answering: ${missing.join(', ')}.` : '',
      invalidCitation || uncited ? citationCorrection(sources.keys(), externalUrls) : '',
      !answer.trim() && !hasProposals ? 'Complete the requested answer or proposal using the actual observations above.' : ''
    ])
  };
}
