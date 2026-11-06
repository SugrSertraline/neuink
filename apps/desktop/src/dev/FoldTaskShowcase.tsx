import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import { FoldControls } from '@/modules/reader/folding/FoldControls';
import { FoldTaskDialog } from '@/modules/reader/folding/FoldTaskDialog';
import type { FoldTaskSnapshot } from '@/modules/reader/folding/foldTasks';
import type { FoldReader, FoldLevel } from '@/modules/reader/folding/useFoldReader';
import type { SourceSegment } from '@/shared/types/domain';
import type { FoldRecord } from '@/shared/ipc/foldingApi';
import '@/styles/globals.css';

// Only UI fixtures: no model requests, IPC, real paper content or disk writes.
const segments: SourceSegment[] = Array.from({ length: 36 }, (_, index) => ({ uid: `example-${index}`, page_idx: Math.floor(index / 4),
  segment_type: 'paragraph', bbox: null, markdown: null,
  text: `段落 ${index + 1}：阅读过程中，读者可以按照当前问题选择需要展开的内容。系统保留原始段落与来源位置，将较长正文整理为不同详略层级；标题、公式、图表和短段落保留原样。用户先选择处理范围，再开始生成，随时暂停或者结束任务，已经保存的结果继续用于后续阅读。` }));
const recordFor = (segment: SourceSegment): FoldRecord => ({ segment_uid: segment.uid, source: segment.text,
  evidence: [0], brief: [segment.text.split('。')[0] + '。'], key: '按需阅读详略。', takeaway: '按需阅读详略。', topic: '阅读详略', model: 'preview', generated_at: '' });

function FoldTaskShowcase() {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<FoldLevel>('full');
  const [task, setTask] = useState<FoldTaskSnapshot | null>(null);
  const [records, setRecords] = useState<Record<string, FoldRecord>>({});
  const [mode, setMode] = useState<'ready' | 'loading' | 'error' | 'empty'>('ready');
  const running = Boolean(task && ['running', 'pausing', 'paused', 'stopping'].includes(task.status));
  const waiting = (snapshot: FoldTaskSnapshot) => snapshot.segments.filter(segment => ![
    ...snapshot.progress.completedSegmentUids, ...snapshot.progress.canceledSegmentUids, ...snapshot.progress.cachedSegmentUids
  ].includes(segment.uid));
  useEffect(() => {
    if (!task || !['running', 'pausing', 'stopping'].includes(task.status)) return;
    const timer = setTimeout(() => {
      if (task.status === 'stopping') {
        setTask({ ...task, status: 'canceled', progress: { ...task.progress, activeSegmentUids: [] } }); return;
      }
      const completed = [...task.progress.completedSegmentUids, ...task.progress.activeSegmentUids.filter(uid => !task.progress.canceledSegmentUids.includes(uid))];
      setRecords(current => ({ ...current, ...Object.fromEntries(task.segments.filter(segment => completed.includes(segment.uid)).map(segment => [segment.uid, recordFor(segment)])) }));
      const next = { ...task, progress: { ...task.progress, completed: completed.length, completedSegmentUids: completed, activeSegmentUids: [] } };
      const pending = waiting(next);
      setTask({ ...next, status: pending.length ? (task.status === 'pausing' ? 'paused' : 'running') : 'succeeded',
        progress: { ...next.progress, activeSegmentUids: task.status === 'running' ? pending.slice(0, 3).map(segment => segment.uid) : [] } });
    }, task.status === 'running' ? 3500 : 900);
    return () => clearTimeout(timer);
  }, [task]);
  const fold: FoldReader = {
    root: 'preview', entryId: 'example', title: '阅读详略任务检查', segments: mode === 'empty' ? [] : segments,
    ready: mode !== 'loading', loadState: mode === 'empty' ? 'ready' : mode, records, level, setLevel, overrides: {}, setOverride: () => {},
    running, task, error: null, reload: async () => setMode('ready'),
    start: (chosen = segments, force = false) => {
      if (running) return false;
      const cached = force ? [] : chosen.filter(segment => records[segment.uid]).map(segment => segment.uid);
      const pending = chosen.filter(segment => !cached.includes(segment.uid));
      setTask({ status: pending.length ? 'running' : 'succeeded', segments: chosen, force, progress: { phase: 'generating', total: pending.length, completed: 0, failed: 0,
        activeSegmentUids: pending.slice(0, 3).map(segment => segment.uid), completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: cached, canceledSegmentUids: [] } });
      return true;
    },
    pause: () => setTask(current => current ? { ...current, status: 'pausing' } : null),
    resume: () => setTask(current => current ? { ...current, status: 'running', progress: { ...current.progress, activeSegmentUids: waiting(current).slice(0, 3).map(segment => segment.uid) } } : null),
    cancel: () => setTask(current => current ? { ...current, status: 'stopping' } : null),
    cancelSegments: uids => setTask(current => current ? { ...current, progress: { ...current.progress, canceledSegmentUids: [...new Set([...current.progress.canceledSegmentUids, ...uids])] } } : null)
  };
  return <main className="min-h-screen bg-background p-6 text-foreground">
    <h1 className="mb-2 text-lg font-semibold">重排阅读 · 详略任务</h1>
    <p className="mb-4 text-sm text-muted-foreground">虚构正文与模拟进度，仅检查真实组件的交互与排版。</p>
    <div className="mb-6 flex flex-wrap gap-2">
      {(['ready', 'loading', 'error', 'empty'] as const).map(value => <Button key={value} size="sm" variant="outline" disabled={running} onClick={() => { setMode(value); setTask(null); }}>{({ ready: '正常列表', loading: '读取中', error: '读取失败', empty: '空列表' })[value]}</Button>)}
      <Button size="sm" variant="outline" disabled={running} onClick={() => { setRecords({ [segments[0].uid]: recordFor(segments[0]) }); setTask(null); }}>预置缓存</Button>
      <Button size="sm" variant="outline" disabled={running} onClick={() => {
        setRecords(Object.fromEntries([segments[0], segments[4]].map(segment => [segment.uid, recordFor(segment)])));
        setTask({ status: 'failed', force: false, segments: segments.slice(0, 4), error: '部分段落未完成，可以筛选后选择重试。',
          progress: { phase: 'preparing', total: 4, completed: 1, failed: 1, activeSegmentUids: [], completedSegmentUids: [segments[0].uid],
            failedSegmentUids: [segments[1].uid], canceledSegmentUids: [segments[2].uid], cachedSegmentUids: [],
            segmentErrors: { [segments[1].uid]: '模型输出不完整，请重试此段。' } } });
      }}>混合状态</Button>
      <Button size="sm" variant="outline" onClick={() => { document.documentElement.style.zoom = document.documentElement.style.zoom === '1.25' ? '1' : '1.25'; }}>切换 125% 界面缩放</Button>
    </div>
    <FoldControls fold={fold} onLevelChange={setLevel} onShowProgress={() => setOpen(true)} />
    <FoldTaskDialog open={open} onOpenChange={setOpen} fold={fold} />
  </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<AppearanceProvider><TooltipProvider><FoldTaskShowcase /></TooltipProvider></AppearanceProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
