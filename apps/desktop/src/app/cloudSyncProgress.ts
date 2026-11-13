import type { CloudSyncState } from '@/shared/ipc/cloudAccountApi';

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1073741824) return `${(value / 1048576).toFixed(1)} MB`;
  return `${(value / 1073741824).toFixed(2)} GB`;
}

/** Progress describes the current phase; unknown work has no invented percentage. */
export function cloudSyncProgress(value: CloudSyncState['task']['progress'] | undefined) {
  const phase = value?.phase || 'observing';
  const labels: Record<string, string> = {
    observing: '核对本地内容', uploading: '上传附件', exchanging: '交换对象与版本',
    downloading: '下载附件', applying: '保存到本地', checking: '核对同步结果', finished: '核对完成',
  };
  let message = labels[phase] || '同步进行中';
  let current = 0, total = 0;
  if (phase === 'observing' || phase === 'checking') {
    current = value?.scanned ?? 0; total = value?.scan_total ?? 0;
    message += total ? ` · 已检查 ${current} / ${total} 个条目` : '…';
  } else if (phase === 'uploading' || phase === 'downloading') {
    current = value?.confirmed_bytes ?? 0; total = value?.total_bytes ?? 0;
    message = total ? `${message} · 附件已确认 ${bytes(current)} / ${bytes(total)}`
      : phase === 'downloading' ? '正在检查待接收内容…' : '正在检查待发送附件…';
  } else if (phase === 'applying') {
    message += ` · 已保存 ${value?.applied ?? 0} 项`;
  }
  return { message, progress: { current, total, percent: total ? Math.min(100, current / total * 100) : 0 } };
}
