import { AgentStoppedError } from '../agent-core/agent';

export type ToolApprovalRequest = { toolCallId: string; toolName: string; input: unknown };
export type RequestToolApproval = (request: ToolApprovalRequest, signal?: AbortSignal) => Promise<boolean>;
export type PendingToolApproval = Readonly<ToolApprovalRequest & {
  id: string; root: string; conversationId: string;
}>;

// Run-owned, not panel-owned: changing tabs/conversations never approves or cancels a request.
// Durable Agent checkpoints own recovery. After restart they request fresh consent.
let snapshot: readonly PendingToolApproval[] = [];
const listeners = new Set<() => void>();
const decisions = new Map<string, (approved: boolean) => void>();
const publish = () => { for (const listener of listeners) listener(); };
export const getToolApprovals = () => snapshot;
export const subscribeToolApprovals = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function decideToolApproval(id: string, approved: boolean) { decisions.get(id)?.(approved); }

export function requestToolApproval(root: string, conversationId: string): RequestToolApproval {
  return (request, signal) => {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (approved?: boolean) => {
        if (!decisions.delete(id)) return;
        signal?.removeEventListener('abort', cancel);
        snapshot = snapshot.filter(item => item.id !== id);
        publish();
        if (approved === undefined) reject(signal?.reason ?? new AgentStoppedError('任务已停止，未执行待确认操作。'));
        else resolve(approved);
      };
      const cancel = () => finish();
      decisions.set(id, finish);
      signal?.addEventListener('abort', cancel, { once: true });
      snapshot = [...snapshot, Object.freeze({ ...request, input: structuredClone(request.input), id, root, conversationId })];
      publish();
    });
  };
}
