import type { AssistantTagProposal, AssistantTaskPlan } from '@/shared/types/assistant';
import { requestAssistantClarification } from '../runtime/clarification';

export function buildTagProposal(plan: AssistantTaskPlan): AssistantTagProposal {
  const change = plan.tagChange;
  if (!change) {
    requestAssistantClarification('tag_target', '你希望创建、添加、移除还是重命名 Tag？');
  }
  if (!change.name && !change.tagId) {
    requestAssistantClarification('tag_target', '请告诉我具体的 Tag 名称。');
  }
  if (change.action === 'rename' && !change.newName) {
    requestAssistantClarification('tag_target', '请告诉我这个 Tag 的新名称。');
  }
  if ((change.action === 'attach' || change.action === 'detach') && change.entryIds.length === 0) {
    requestAssistantClarification('active_entry', '请用 @ 指定要修改 Tag 的 Entry。');
  }
  return {
    action: change.action,
    createdAt: new Date().toISOString(),
    entryIds: change.entryIds,
    id: `tag-proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: change.name,
    newName: change.newName,
    status: 'pending',
    tagId: change.tagId
  };
}

export function isTagTask(intent: AssistantTaskPlan['intent']) {
  return (
    intent === 'tag_attach' ||
    intent === 'tag_create' ||
    intent === 'tag_detach' ||
    intent === 'tag_update'
  );
}
