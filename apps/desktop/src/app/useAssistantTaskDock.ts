import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantDockTask } from '@/shared/components/JobStatusDock';
import {
  getAssistantBackgroundRuns, getAssistantMessageQueues, stopAssistantBackgroundRun,
  subscribeAssistantBackgroundRun, type AssistantBackgroundRunSnapshot, type AssistantMessageQueueSnapshot,
} from '@/modules/assistant/components/assistantBackgroundRuns';
import { requestOpenAssistantConversation } from '@/modules/assistant/components/assistantConversationNavigation';
import { getToolApprovals, subscribeToolApprovals } from '@/modules/assistant/runtime/toolApproval';
import { getUserInputs, subscribeUserInputs } from '@/modules/assistant/runtime/userInput';

const identities = new WeakMap<AbortController, string>();
let nextId = 0;
function runId(run: AssistantBackgroundRunSnapshot) {
  let id = identities.get(run.abortController);
  if (!id) { id = `assistant-run:${++nextId}`; identities.set(run.abortController, id); }
  return id;
}

type Waiting = readonly { root: string; conversationId: string }[];
export function projectAssistantDockTasks(root: string, runs: AssistantBackgroundRunSnapshot[], queues: AssistantMessageQueueSnapshot[],
  approvals: Waiting, questions: Waiting): AssistantDockTask[] {
  const visibleRuns = runs.filter(run => run.root === root && run.taskKind !== 'paper-import');
  const visibleQueues = queues.filter(queue => queue.root === root && queue.items.length > 0);
  const tasks: AssistantDockTask[] = visibleRuns.map(run => {
    const hasInput = questions.some(item => item.root === root && item.conversationId === run.conversationId);
    const hasApproval = approvals.some(item => item.root === root && item.conversationId === run.conversationId);
    const queue = visibleQueues.find(item => item.conversationId === run.conversationId);
    const stopping = run.abortController.signal.aborted;
    return { id: runId(run), title: run.conversation?.title || '新对话', question: run.question,
      status: stopping ? 'stopping' : hasInput || hasApproval ? 'waiting' : 'running',
      detail: stopping ? '正在停止并保存本次对话' : hasInput ? '等待你的选择' : hasApproval ? '等待操作确认' : '正在处理',
      queuedCount: queue?.items.length ?? 0, canOpen: Boolean(run.conversationId), canStop: !stopping,
    };
  });
  for (const queue of visibleQueues) {
    if (visibleRuns.some(run => run.conversationId === queue.conversationId)) continue;
    const editing = queue.items[0].editing;
    tasks.push({ id: `assistant-queue:${queue.id}`, title: queue.conversationTitle || '对话消息队列',
      question: queue.items[0].draft.question, status: queue.paused ? 'paused' : editing ? 'waiting' : 'queued',
      detail: editing ? '正在编辑待发消息，保存后可继续' : queue.pauseReason === 'failed' ? '上次执行未完成，待发消息已保留'
        : queue.paused ? '待发消息已暂停，可返回对话继续或取消' : '等待按顺序发送',
      queuedCount: queue.items.length, canOpen: Boolean(queue.conversationId), canStop: false,
    });
  }
  return tasks;
}

/** Subscribe to owners, not streamed messages. Unchanged projection never rerenders App. */
export function useAssistantTaskDock(root: string | null, showAssistant: () => void) {
  const [snapshot, setSnapshot] = useState<{ root: string | null; tasks: AssistantDockTask[] }>({ root: null, tasks: [] });
  const currentRoot = useRef(root); currentRoot.current = root;
  useEffect(() => {
    let disposed = false;
    let last = '';
    const sync = () => {
      if (disposed) return;
      const tasks = root ? projectAssistantDockTasks(root, getAssistantBackgroundRuns(root), getAssistantMessageQueues(root), getToolApprovals(), getUserInputs()) : [];
      const serialized = JSON.stringify(tasks);
      if (serialized === last) return;
      last = serialized; setSnapshot({ root, tasks });
    };
    const stops = [subscribeAssistantBackgroundRun(sync), subscribeToolApprovals(sync), subscribeUserInputs(sync)];
    sync();
    return () => { disposed = true; stops.forEach(stop => stop()); };
  }, [root]);

  const openTask = useCallback((id: string) => {
    if (!root || currentRoot.current !== root) return;
    const run = getAssistantBackgroundRuns(root).find(item => runId(item) === id && item.taskKind !== 'paper-import');
    const queue = getAssistantMessageQueues(root).find(item => `assistant-queue:${item.id}` === id);
    const conversationId = run?.conversationId ?? queue?.conversationId;
    if (!conversationId) return;
    showAssistant();
    requestOpenAssistantConversation(root, conversationId);
  }, [root, showAssistant]);
  const stopTask = useCallback((id: string) => {
    if (!root || currentRoot.current !== root) return;
    const run = getAssistantBackgroundRuns(root).find(item => runId(item) === id && item.taskKind !== 'paper-import');
    if (run && !run.abortController.signal.aborted) stopAssistantBackgroundRun(run.abortController);
  }, [root]);
  return { tasks: snapshot.root === root ? snapshot.tasks : [], openTask, stopTask };
}
