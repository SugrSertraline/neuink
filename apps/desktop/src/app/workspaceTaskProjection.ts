import type { PdfParseQueue } from '@/shared/ipc/pdfParseQueueApi';
import type { Job, SearchIndexBuildStatus } from '@/shared/ipc/workspaceApi';
import { isUnfinishedJob, recentBackgroundJobs } from '@/shared/lib/backgroundJobs';

/** Persisted parser queue fills gaps between local uploads and remote processing.
 * This is display-only: it neither creates jobs nor submits parsing requests. */
export function workspaceTaskProjection(root: string | null, jobs: Job[], queue: PdfParseQueue, parserConfigured: boolean,
  vectorBuild?: SearchIndexBuildStatus | null,
  pdfDrop?: { id: string; root: string; startedAt: number; completed: number; total: number } | null): Job[] {
  if (!root) return [];
  const scopedJobs = jobs.filter(job => job.scope?.root === root);
  const trackedParserEntries = new Set(scopedJobs.filter(job => job.kind === 'parser' && isUnfinishedJob(job))
    .flatMap(job => job.scope?.kind === 'entry' ? [job.scope.entry_id] : []));
  const projected: Job[] = [];
  for (const [kind, entries] of [['active', queue.active], ['waiting', queue.waiting]] as const) {
    for (const [index, entry] of entries.entries()) {
      if (trackedParserEntries.has(entry.id) || !entry.pdf) continue;
      trackedParserEntries.add(entry.id);
      const status = entry.pdf.parse.status;
      if (!['queued', 'uploading', 'uploaded', 'parsing'].includes(status)) continue;
      const stage = kind === 'waiting' ? (parserConfigured ? `等待解析 · 队列第 ${index + 1} 项` : '等待配置解析服务，可在条目库调整队列')
        : status === 'uploading' ? '正在上传 PDF' : status === 'parsing' ? '服务端解析中' : '等待解析服务处理';
      projected.push({
        id: `parse-queue:${entry.id}`, kind: 'parser', scope: { kind: 'entry', root, entry_id: entry.id },
        created_at: entry.created_at, updated_at: entry.pdf.parse.updated_at,
        status: kind === 'waiting' ? 'queued' : 'processing', message: `${entry.title} · ${stage}`, error: null,
        progress: { current: 0, total: 0, percent: 0 },
      });
    }
  }
  if (vectorBuild?.root === root && ['queued', 'running'].includes(vectorBuild.state)
    && !scopedJobs.some(job => ['index_build', 'vectorize'].includes(job.kind) && isUnfinishedJob(job))) {
    const current = Math.max(0, vectorBuild.completed);
    const total = Math.max(0, vectorBuild.total);
    projected.push({ id: `search-index-build:${vectorBuild.started_at_ms}`, kind: 'vectorize',
      scope: { kind: 'workspace', root }, status: vectorBuild.state === 'queued' ? 'queued' : 'processing',
      created_at: new Date(vectorBuild.started_at_ms).toISOString(), updated_at: new Date(vectorBuild.updated_at_ms).toISOString(),
      message: vectorBuild.phase === 'reading' ? '正在读取资料库内容' : vectorBuild.phase === 'embedding' ? '正在生成检索向量' : '正在构建检索索引',
      error: null, progress: { current, total, percent: total > 0 ? Math.min(100, current / total * 100) : 0 },
    });
  }
  if (pdfDrop?.root === root) {
    const time = new Date(pdfDrop.startedAt).toISOString();
    projected.push({ id: `pdf-drop-import:${pdfDrop.id}`, kind: 'pdf_import', scope: { kind: 'workspace', root },
      status: 'processing', created_at: time, updated_at: time, error: null,
      message: `正在批量导入 PDF · 已处理 ${pdfDrop.completed}/${pdfDrop.total} 个，完成后会报告成功与失败数量`,
      progress: { current: pdfDrop.completed, total: pdfDrop.total, percent: pdfDrop.total > 0 ? pdfDrop.completed / pdfDrop.total * 100 : 0 },
    });
  }
  return recentBackgroundJobs([...projected, ...scopedJobs]);
}
