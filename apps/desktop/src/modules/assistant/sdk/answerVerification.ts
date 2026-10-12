import type { AssistantToolTraceEvent, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { AssistantTaskPlan } from '@/shared/types/assistant';
import { ASSISTANT_READ_FAILURES } from '@/shared/lib/assistantReadFailure';
import { paperPresentationError, paperRecords, presentedPaperRecords } from '../research/paperPresentation';
import { citationCorrection, matchedExternalCitationUrls, returnedExternalCitationUrls, taskVerificationCorrection } from './citationContract';
import { hasConfirmedPaperImportOnly } from './researchCompletion';

/** The same evidence/completion contract applies to SDK and native Agent answers. */
export function answerVerification({ answer, question, plan, sources, events, observations,
  hasProposals, availabilityNotes, missing = [] }: {
  answer: string; question: string; plan?: AssistantTaskPlan | null;
  sources: Map<number, ConversationSourceLink>; events: AssistantToolTraceEvent[];
  observations: Array<{ toolName: string; output: unknown }>;
  hasProposals: boolean; availabilityNotes: string[]; missing?: string[];
}): { message: string; correction: string } | undefined {
  const records = paperRecords(events.flatMap(event => event.status === 'done' ? event.researchPapers ?? [] : []), [...sources.values()]);
  const presentationError = paperPresentationError(answer, records);
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
  if (!presentationError && !missing.length && !invalidCitation && !uncited && (answer.trim() || hasProposals)) return;
  return {
    message: invalidCitation || uncited ? ASSISTANT_READ_FAILURES.citation : ASSISTANT_READ_FAILURES.contract,
    correction: taskVerificationCorrection(question, [
      presentationError ?? '', missing.length ? `Call these required tools before answering: ${missing.join(', ')}.` : '',
      invalidCitation || uncited ? citationCorrection(sources.keys(), externalUrls) : '',
      !answer.trim() && !hasProposals ? 'Complete the requested answer or proposal using the actual observations above.' : ''
    ])
  };
}
