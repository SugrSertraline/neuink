import type { AgentCheckpoint, RunBudget } from '../agent-core';
import { AgentPersistenceError } from '../agent-core';
import { saveAgentExecution, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';

/** Application-owned durable state. No model credentials or executable configuration belong here. */
export class DurableExecution {
  private writes: Promise<void> = Promise.resolve();
  private failed = false;
  constructor(readonly root: string, readonly record: AgentExecutionRecord, readonly budget: RunBudget) {}
  get<T>(key: string): T | undefined { return this.record.payload[key] as T | undefined; }
  set(key: string, value: unknown) { this.record.payload[key] = value; }
  actor<M>(id: string): AgentCheckpoint<M> | undefined { return this.get(`actor:${id}`); }
  async saveActor<M>(id: string, value: AgentCheckpoint<M>) {
    this.set(`actor:${id}`, value);
    await this.flush();
  }
  flush(): Promise<void> {
    this.record.payload.budget = this.budget.snapshot();
    // Capture state now; late/uncooperative tools cannot mutate an already queued checkpoint.
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(JSON.stringify(this.record.payload)) as Record<string, unknown>;
    } catch {
      this.failed = true;
      this.writes = this.writes.then(() => {
        throw new AgentPersistenceError('任务状态无法序列化，已停止执行。这是程序错误，请报告此问题。');
      });
      return this.writes;
    }
    const status = this.record.status;
    this.writes = this.writes.then(async () => {
      if (this.failed) throw new AgentPersistenceError('Execution persistence is unavailable.');
      try {
        const next = await saveAgentExecution(this.root, { ...this.record, status, payload });
        this.record.revision = next.revision;
        this.record.updatedAt = next.updatedAt;
      } catch (error) {
        this.failed = true;
        throw checkpointSaveError(error);
      }
    });
    return this.writes;
  }
}

/** Only known storage diagnostics become user messages; never expose paths, bodies or credentials. */
function checkpointSaveError(error: unknown): AgentPersistenceError {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const reasons: Array<[string, string]> = [
    ['Invalid execution conversation', '会话标识校验失败。这是程序错误，请报告此问题。'],
    ['Invalid execution id', '任务标识校验失败。这是程序错误，请报告此问题。'],
    ['Execution conversation no longer exists', '所属对话已不存在，请重新打开对话或新建任务。'],
    ['Execution changed in another runner', '任务已被另一执行器更新，请重新打开对话后继续。'],
    ['Another process is saving this execution', '另一个进程正在保存任务，请稍后继续。'],
    ['Checkpoint too large', '任务记录超过 16 MiB 存储上限，请缩小任务范围。'],
    ['escapes workspace', '任务存储路径超出资料库，已拒绝写入。请检查资料库路径。'],
    ['os error 5', '没有写入权限，请检查资料库目录权限。'],
    ['os error 112', '磁盘空间不足，请释放空间后继续。'],
  ];
  const reason = reasons.find(([known]) => message.includes(known))?.[1]
    ?? '任务存储写入失败，请检查资料库是否可访问及磁盘空间。';
  return new AgentPersistenceError(`无法安全保存任务，已停止执行。${reason}`);
}

/** Explicit allowlist: unknown and external tools are NOT assumed read-only. */
export function canReplayAssistantTool(name: string) {
  return new Set(['ask_user', 'search_segments', 'read_segment_content', 'read_entry_assistant_context',
    'search_sciverse_evidence', 'read_sciverse_content', 'read_current_note', 'read_note',
    'task_run_subagent', 'note_propose_create', 'note_propose_patch',
    'segment_note_propose_patch', 'entry_propose_meta_patch', 'tag_propose_change']).has(name);
}

export async function bindExecutionIdentity(execution: DurableExecution | undefined, actorId: string, identity: unknown) {
  if (!execution) return;
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `identity:${actorId}`;
  const previous = execution.get<string>(key);
  if (previous && previous !== digest) throw new Error('模型或 Agent 权限配置已改变，不能沿用旧任务的执行上下文。请恢复原配置或开始新任务。');
  execution.set(key, digest);
}
