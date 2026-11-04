export const FOLD_TASK_FILTERS = [
  { value: 'all', label: '全部' }, { value: 'pending', label: '待生成' },
  { value: 'processing', label: '处理中' }, { value: 'ready', label: '已有结果' },
  { value: 'failed', label: '失败' }, { value: 'canceled', label: '已取消' }
] as const;
export type FoldTaskFilter = typeof FOLD_TASK_FILTERS[number]['value'];
export type FoldTaskRowStatus = '未生成' | '待处理' | '生成中' | '保存中' | '已完成' | '失败' | '已取消' | '已缓存' | '已暂停' | '未完成';

export function foldTaskFilterForStatus(status: FoldTaskRowStatus): Exclude<FoldTaskFilter, 'all'> {
  if (status === '生成中' || status === '保存中') return 'processing';
  if (status === '已完成' || status === '已缓存') return 'ready';
  if (status === '失败') return 'failed';
  if (status === '已取消') return 'canceled';
  return 'pending';
}
