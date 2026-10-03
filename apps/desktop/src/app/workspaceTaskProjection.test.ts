import { describe, expect, it } from 'vitest';
import type { EntryMeta } from '@/shared/types/domain';
import type { Job, SearchIndexBuildStatus } from '@/shared/ipc/workspaceApi';
import { workspaceTaskProjection } from './workspaceTaskProjection';

const entry = (id: string, status: NonNullable<EntryMeta['pdf']>['parse']['status'] = 'queued'): EntryMeta => ({
  id, title: `论文 ${id}`, tags: [], fields: {}, contents: [], created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
  pdf: { file_name: `${id}.pdf`, content_hash: '', imported_at: '', parse: { status, updated_at: '2026-10-03T00:00:00Z', endpoint: null, task_id: null, message: null } },
});
const job = (id: string, root = 'A', status: Job['status'] = 'processing'): Job => ({
  id: `job-${id}`, kind: 'parser', scope: { kind: 'entry', root, entry_id: id }, status,
  created_at: '', updated_at: '', message: null, error: null, progress: { current: 0, total: 0, percent: 0 },
});
describe('workspace task projection', () => {
  it('includes persisted waiting and remote parsing work without inventing percentages', () => {
    const tasks = workspaceTaskProjection('A', [], { waiting: [entry('1'), entry('2')], active: [entry('3', 'parsing')], failed: [] }, true);
    expect(tasks.map(task => task.status)).toEqual(['processing', 'queued', 'queued']);
    expect(tasks.find(task => task.id === 'parse-queue:2')?.message).toContain('队列第 2 项');
    expect(tasks.every(task => task.progress.total === 0)).toBe(true);
  });
  it('does not duplicate an active job, but keeps remote work after a local upload job ends', () => {
    const queue = { waiting: [], active: [entry('1', 'uploaded')], failed: [] };
    expect(workspaceTaskProjection('A', [job('1')], queue, true)).toHaveLength(1);
    const afterUpload = workspaceTaskProjection('A', [job('1', 'A', 'succeeded')], queue, true);
    expect(afterUpload.filter(task => task.status === 'processing')).toHaveLength(1);
    expect(afterUpload[0].message).toContain('等待解析服务');
  });
  it('does not invent work for unparsed/failed entries or leak another library', () => {
    const queue = { waiting: [entry('1', 'not_started'), entry('2', 'failed'), entry('3')], active: [], failed: [entry('4', 'failed')] };
    const tasks = workspaceTaskProjection('A', [job('other', 'B')], queue, false);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].message).toContain('等待配置解析服务');
    expect(workspaceTaskProjection(null, [job('1')], queue, true)).toEqual([]);
  });
  it('does not trim paused work and removes projected work when the queue completes', () => {
    const jobs = Array.from({ length: 30 }, (_, i) => ({ ...job(`${i}`, 'A', 'paused'), kind: 'translation' as const }));
    expect(workspaceTaskProjection('A', jobs, { waiting: [], active: [], failed: [] }, true)).toHaveLength(30);
    expect(workspaceTaskProjection('A', [], { waiting: [], active: [], failed: [] }, true)).toEqual([]);
  });
  it('projects index phases and dropped PDF batches only while their own workspace is running', () => {
    const queue = { waiting: [], active: [], failed: [] };
    const vector: SearchIndexBuildStatus = { root: 'A', state: 'running', scope: 'all', phase: 'embedding', completed: 2, total: 8,
      message: 'private details', error: null, started_at_ms: 1000, updated_at_ms: 2000 };
    const drop = { id: 'batch', root: 'A', startedAt: 1000, completed: 1, total: 3 };
    const tasks = workspaceTaskProjection('A', [], queue, true, vector, drop);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ kind: 'vectorize', message: '正在生成检索向量', progress: { current: 2, total: 8, percent: 25 } });
    expect(tasks[1].message).toContain('已处理 1/3');
    expect(tasks[1].message).not.toContain('成功 1');
    expect(workspaceTaskProjection('B', [], queue, true, vector, drop)).toEqual([]);
    expect(workspaceTaskProjection('A', [], queue, true, { ...vector, state: 'ready' }, null)).toEqual([]);
    const existing = { ...job('index'), kind: 'index_build' as const };
    expect(workspaceTaskProjection('A', [existing], queue, true, vector)).toEqual([existing]);
  });
});
