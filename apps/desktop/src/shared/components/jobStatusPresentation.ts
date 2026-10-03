import type { Job } from '@/shared/ipc/workspaceApi';
import { ASSISTANT_IMPORT_INCOMPLETE, formatAssistantError } from '@/shared/lib/assistantDebug';
import { isUnfinishedJob } from '@/shared/lib/backgroundJobs';
export { isUnfinishedJob } from '@/shared/lib/backgroundJobs';

/** Read-only projection: execution and cancellation remain with the original task owner. */
export type AssistantDockTask = {
  id: string;
  title: string;
  question: string;
  status: 'running' | 'waiting' | 'queued' | 'paused' | 'stopping';
  detail?: string;
  queuedCount?: number;
  canOpen: boolean;
  canStop: boolean;
};

export const assistantTaskStatusLabels: Record<AssistantDockTask['status'], string> = {
  running: '进行中', waiting: '等待确认或选择', queued: '排队中', paused: '已暂停', stopping: '正在停止',
};

export function jobTitle(job: Job) {
  if (job.id.startsWith('research-import:')) return '论文下载与添加';
  if (job.id.startsWith('sciverse-import:')) return 'Sciverse 论文保存';
  if (job.id.startsWith('selection-translation:')) return '选区翻译';
  if (job.id.startsWith('single-segment-translation:')) return '片段翻译';
  const labels: Record<Job['kind'], string> = {
    index_build: '索引构建', llm: '模型任务', parser: 'PDF 解析', pdf_import: 'PDF 导入',
    translation: '全文翻译', paragraph_translation: '段落翻译', vectorize: '向量构建',
  };
  return labels[job.kind] ?? '后台任务';
}

export function jobStatusLabel(job: Job) {
  const labels: Record<Job['status'], string> = {
    canceled: '已取消', paused: '已暂停', failed: '失败', processing: '进行中', queued: '排队中', succeeded: '已完成',
  };
  return labels[job.status];
}

export function jobDescription(job: Job, debug: boolean): string {
  const paperImport = job.id.startsWith('research-import:') || job.id.startsWith('sciverse-import:');
  if (job.status === 'failed' || job.error) return formatAssistantError(job.error || job.message, {
    debug, fallback: paperImport ? ASSISTANT_IMPORT_INCOMPLETE : '任务未完成，请核对结果后重试。',
  });
  // Historical import messages can include remote error bodies even after cancellation/completion.
  if (paperImport && job.status === 'canceled') return '论文添加已停止，请先核对条目库。';
  if (paperImport && job.status === 'succeeded') return '论文添加已结束，请在条目库核对结果。';
  if (job.status === 'queued') return job.message || '等待执行';
  if (job.kind === 'translation' && job.status === 'processing') {
    const received = job.message?.match(/已接收\s*(\d+)\s*字/)?.[1];
    return received ? `正在翻译 · 已接收 ${received} 字` : '正在翻译';
  }
  return job.message || jobStatusLabel(job);
}

export function formatJobProgress(job: Job) {
  if (job.progress.total <= 0) return null;
  return job.id.startsWith('research-import:')
    ? `已处理 ${job.progress.current}/${job.progress.total} 篇`
    : `${job.progress.current}/${job.progress.total}`;
}

export function summarizeTasks(jobs: Job[], assistantTasks: AssistantDockTask[], debug: boolean) {
  const unfinished = jobs.filter(isUnfinishedJob);
  const count = unfinished.length + assistantTasks.length;
  const running = unfinished.filter(job => job.status === 'processing').length
    + assistantTasks.filter(task => task.status === 'running').length;
  const queued = unfinished.filter(job => job.status === 'queued').length
    + assistantTasks.filter(task => task.status === 'queued').length;
  const paused = unfinished.filter(job => job.status === 'paused').length
    + assistantTasks.filter(task => task.status === 'paused').length;
  const waiting = assistantTasks.filter(task => task.status === 'waiting').length;
  const stopping = assistantTasks.filter(task => task.status === 'stopping').length;
  const failed = jobs.find(job => job.status === 'failed');
  const counts = [[running, '进行中'], [queued, '排队'], [paused, '暂停'], [waiting, '等待你处理'], [stopping, '正在停止']] as const;
  return {
    count, running,
    title: count ? `${count} 个未完成任务` : failed ? '最近任务有失败' : '最近任务',
    description: count ? counts.filter(([value]) => value > 0).map(([value, label]) => `${value} ${label}`).join(' · ')
      : failed ? jobDescription(failed, debug) : '当前没有未完成任务',
    tone: running ? 'running' : count ? 'waiting' : failed ? 'failed' : 'complete',
  };
}
