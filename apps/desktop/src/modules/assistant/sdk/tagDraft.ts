import { analyzeEntryTags } from '@/shared/ipc/assistantApi';
import type { AssistantTagProposal, AssistantTaskPlan } from '@/shared/types/assistant';
import type { SkillPackage } from '@/shared/types/agentRuntime';
import { requestAssistantClarification } from '../runtime/clarification';

export async function generateTagDraftProposals({
  plan,
  question,
  root,
  skill
}: {
  plan: AssistantTaskPlan;
  question: string;
  root: string;
  skill: SkillPackage;
}): Promise<AssistantTagProposal[]> {
  const change = plan.tagChange;
  const entryId = change?.entryIds[0] ?? plan.target.entryId;
  if (!change?.deriveFromDocument || !entryId) {
    requestAssistantClarification(
      'active_entry',
      '请用 @ 指定一个要阅读并补充 Tag 的 Entry 或 PDF。'
    );
  }
  const result = await analyzeEntryTags({
    entryId,
    instruction: question,
    root,
    skillId: skill.id
  });
  const now = new Date().toISOString();
  return result.recommendations.map((recommendation, index) => ({
    action: 'attach',
    confidence: recommendation.confidence,
    createdAt: now,
    entryIds: [entryId],
    id: `tag-proposal-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    name: recommendation.path,
    rationale: recommendation.reason,
    skillVersion: result.skill_version,
    status: 'pending'
  }));
}
