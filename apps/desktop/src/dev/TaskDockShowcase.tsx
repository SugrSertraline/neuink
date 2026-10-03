import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@/components/ui/button';
import { JobStatusDock, type AssistantDockTask } from '@/shared/components/JobStatusDock';
import type { Job } from '@/shared/ipc/workspaceApi';
import { AssistantMessageQueue } from '@/modules/assistant/components/AssistantMessageQueue';
import {
  cancelAssistantQueuedMessage, finishAssistantBackgroundRun, getAssistantBackgroundRuns, getAssistantMessageQueues,
  queueAssistantBackgroundRun, setAssistantBackgroundRun, stopAssistantBackgroundRun, subscribeAssistantBackgroundRun,
  type AssistantMessageQueueSnapshot,
} from '@/modules/assistant/components/assistantBackgroundRuns';
import type { QueuedAssistantDraft } from '@/modules/assistant/components/assistantRunController';
import type { Conversation } from '@/shared/ipc/assistantApi';
import '@/styles/globals.css';

// Isolated display fixture: no workspace, persistence, model requests or actual cancellation.
const baseJob: Job = { id: 'fixture', kind: 'parser', status: 'processing', created_at: '', updated_at: '',
  message: null, error: null, progress: { current: 0, total: 0, percent: 0 }, scope: { kind: 'entry', root: 'fixture', entry_id: 'paper' } };
const jobs: Job[] = [
  { ...baseJob, id: 'translation', kind: 'translation', message: '已接收 3148 字', progress: { current: 3, total: 20, percent: 15 } },
  { ...baseJob, id: 'research-import:download', kind: 'pdf_import', message: '正在下载：Attention Is All You Need', progress: { current: 2, total: 6, percent: 100 / 3 } },
  { ...baseJob, id: 'parse-queue:waiting', status: 'queued', message: '演示论文 · 等待解析 · 队列第 1 项' },
  { ...baseJob, id: 'translation-paused', kind: 'translation', status: 'paused', message: '翻译已暂停，可返回任务继续', progress: { current: 10, total: 20, percent: 50 } },
  { ...baseJob, id: 'selection-translation:one', kind: 'paragraph_translation' },
  { ...baseJob, id: 'single-segment-translation:one', kind: 'paragraph_translation' },
  { ...baseJob, id: 'failed', kind: 'pdf_import', status: 'failed', error: 'HTTP 503 sample' },
  { ...baseJob, id: 'completed', status: 'succeeded', message: '论文解析完成', progress: { current: 1, total: 1, percent: 100 } },
];
const assistantTasks: AssistantDockTask[] = [
  { id: 'dialog', title: '围绕 Transformer 的阅读笔记', question: '请比较这些论文的方法和实验，并整理为中文阅读笔记。',
    status: 'running', detail: '正在处理', queuedCount: 3, canOpen: true, canStop: true },
  { id: 'waiting', title: '推荐相关论文', question: '检索后把这几篇论文添加到本地', status: 'waiting',
    detail: '等待操作确认', queuedCount: 1, canOpen: true, canStop: true },
  ...Array.from({ length: 15 }, (_, index): AssistantDockTask => ({ id: `queue-${index}`, title: `研究方向 ${index + 1} 的后续问题`,
    question: '把未发送的补充问题暂存在队列中，稍后继续。', status: 'paused', queuedCount: 2, canOpen: true, canStop: false })),
];

function queueDraft(question: string): QueuedAssistantDraft {
  return { question, snapshot: { text: question, mentions: [] }, contextItems: [], contextPlan: null,
    activeEntry: null, activeNote: null, activeSegment: null,
    activeSurface: { kind: 'library', capturedAt: '', entryId: null, noteId: null, pane: 'left', segmentUid: null, surfaceKey: 'library' },
    scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } };
}

function MessageQueueFixture() {
  const [root] = useState(() => `task-dock-queue-fixture:${crypto.randomUUID()}`);
  const [queue, setQueue] = useState<AssistantMessageQueueSnapshot | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [restart, setRestart] = useState(0);
  const [width, setWidth] = useState(360);
  const actions = useRef<{ complete: () => void; stop: () => void } | null>(null);

  useEffect(() => {
    let disposed = false;
    const fixtureRoot = `${root}:${restart}`;
    const conversation: Conversation = { id: `conversation:${fixtureRoot}`, title: '消息队列检查对话', messages: [],
      scope_snapshot: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, created_at: '', updated_at: '' };
    const sync = () => {
      if (disposed) return;
      setCurrentQuestion(getAssistantBackgroundRuns(fixtureRoot)[0]?.question ?? null);
      setQueue(getAssistantMessageQueues(fixtureRoot)[0] ?? null);
    };
    const unsubscribe = subscribeAssistantBackgroundRun(sync);
    const start = (question: string, current = conversation) => {
      const controller = new AbortController();
      setAssistantBackgroundRun({ root: fixtureRoot, abortController: controller, conversation: current, conversationId: current.id,
        question, error: null, streamingMessageId: 'fixture-reply', toolEventsByMessageId: {}, noteProposalsByMessageId: {} });
      setSent(previous => [...previous, question]);
      return controller;
    };
    const execute = (current: Conversation, draft: QueuedAssistantDraft) => {
      if (!disposed) start(draft.question, current);
    };
    setSent([]);
    const initial = start('请概括这篇论文的研究问题。');
    queueAssistantBackgroundRun(initial, queueDraft('再列出三个关键实验结论。'), execute);
    queueAssistantBackgroundRun(initial, queueDraft('最后整理成一段中文阅读笔记，并保留来源。'), execute);
    actions.current = {
      complete: () => { const run = getAssistantBackgroundRuns(fixtureRoot)[0]; if (run) finishAssistantBackgroundRun(run.abortController); },
      stop: () => { const run = getAssistantBackgroundRuns(fixtureRoot)[0]; if (run) { stopAssistantBackgroundRun(run.abortController); finishAssistantBackgroundRun(run.abortController); } },
    };
    sync();
    return () => {
      disposed = true;
      actions.current = null;
      unsubscribe();
      // Dispose this fixture only. Never clear another example's registry entries.
      for (const item of getAssistantMessageQueues(fixtureRoot)) {
        for (const message of item.items) cancelAssistantQueuedMessage(item.id, message.id);
      }
      for (const run of getAssistantBackgroundRuns(fixtureRoot)) {
        stopAssistantBackgroundRun(run.abortController);
        finishAssistantBackgroundRun(run.abortController);
      }
    };
  }, [root, restart]);

  return <section aria-label="真实消息队列交互示例" className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-sm font-medium">真实消息队列 · 仅内存演示</h2>
      {[260, 360, 560].map(value => <Button key={value} size="xs" variant={width === value ? 'secondary' : 'ghost'} onClick={() => setWidth(value)}>队列 {value}px</Button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={!currentQuestion} onClick={() => actions.current?.complete()}>完成当前示例回复</Button>
      <Button size="sm" variant="outline" disabled={!currentQuestion} onClick={() => actions.current?.stop()}>停止当前示例回复</Button>
      <Button size="sm" variant="outline" onClick={() => setRestart(value => value + 1)}>重置消息队列</Button>
    </div>
    <p className="text-xs text-muted-foreground" role="status">{currentQuestion ? `正在执行：${currentQuestion}` : '当前没有执行中的示例回复。'}</p>
    <div className="max-w-full border bg-card p-3" style={{ width }}>
      <AssistantMessageQueue queue={queue} running={Boolean(currentQuestion)} />
      {!queue && <p className="text-xs text-muted-foreground">没有待发送消息</p>}
    </div>
    <div className="text-xs">
      <h3 className="mb-1 font-medium">实际发送顺序</h3>
      <ol className="list-inside list-decimal space-y-1 text-muted-foreground">{sent.map((question, index) => <li key={`${restart}-${index}`}>{question}</li>)}</ol>
    </div>
  </section>;
}

function Showcase() {
  const [scale, setScale] = useState(1);
  const [message, setMessage] = useState('示例数据，不连接真实资料库。');
  const [tasks, setTasks] = useState(assistantTasks);
  useEffect(() => {
    const previous = document.documentElement.style.zoom;
    document.documentElement.style.zoom = String(scale);
    return () => { document.documentElement.style.zoom = previous; };
  }, [scale]);
  return <main className="fixed inset-0 flex min-h-0 min-w-0 flex-col bg-background text-foreground">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
      <span className="text-sm font-medium">实时任务交互检查</span>
      <Button size="sm" variant="outline" onClick={() => setScale(value => value === 1 ? 1.25 : 1)}>{Math.round(scale * 100)}%</Button>
      <Button size="sm" variant="outline" onClick={() => { setTasks(assistantTasks); setMessage('示例已恢复'); }}>恢复示例</Button>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <p className="text-sm text-muted-foreground" role="status">{message}</p>
      <MessageQueueFixture />
    </div>
    <footer className="flex shrink-0 justify-end border-t bg-card p-3">
      <JobStatusDock jobs={jobs} assistantTasks={tasks} entryTitles={{ paper: 'Attention Is All You Need（演示版）' }}
        onOpenJob={job => setMessage(`查看原任务：${job.kind}`)}
        onOpenAssistantTask={id => setMessage(`返回对话：${id}`)}
        onStopAssistantTask={id => { setTasks(current => current.map(task => task.id === id ? { ...task, status: 'stopping', canStop: false } : task)); setMessage(`仅停止：${id}`); }} />
    </footer>
  </main>;
}
const showcaseRoot = createRoot(document.getElementById('root')!);
showcaseRoot.render(<Showcase />);
import.meta.hot?.dispose(() => showcaseRoot.unmount());
