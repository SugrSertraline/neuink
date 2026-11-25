import type { ResearchStatus, ResearchTaskSummary } from '@/shared/ipc/deepResearchApi';
import type { AssistantDockTask } from '@/shared/components/jobStatusPresentation';

export const RESEARCH_DOCK_ID = 'deep-research-task';

/** Display the same native task; this projection never starts another executor. */
export function researchDockTask(status: ResearchStatus | null, tasks: ResearchTaskSummary[]): AssistantDockTask[] {
  const active = status?.active;
  if (!active?.id && !status?.pending_save) return [];
  const task = tasks.find(task => task.id === (active?.id ?? status?.pending_task_id));
  return [{
    id: RESEARCH_DOCK_ID, category: 'research',
    title: active?.installation ? '安装 GPT Researcher' : 'Research 文献调研',
    question: task?.query ?? '', detail: status?.pending_save ? '报告尚未保存，请返回研究面板重试保存。' : active?.stage,
    status: status?.pending_save ? 'waiting' : active?.stage === '正在取消' ? 'stopping' : 'running',
    canOpen: true, canStop: Boolean(active?.id),
  }];
}
