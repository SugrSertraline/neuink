import { AgentStoppedError, AgentToolNotExecutedError } from '../agent-core/agent';
import { previewResearchImport, type ResearchPaper } from '@/shared/ipc/researchApi';
import { allowLocalAgentPermission, hasLocalAgentPermission, localAgentPermission } from '@/shared/lib/localAgentPermissions';

export type ToolApprovalRequest = { toolCallId: string; toolName: string; input: unknown };
export type RequestToolApproval = (request: ToolApprovalRequest, signal?: AbortSignal) => Promise<boolean>;
export type PendingToolApproval = Readonly<ToolApprovalRequest & {
  id: string; root: string; conversationId: string; researchPapers?: ResearchPaper[];
}>;

// Run-owned, not panel-owned: changing tabs/conversations never approves or cancels a request.
// Durable Agent checkpoints own recovery. Explicit native grants are rechecked on every request.
let snapshot: readonly PendingToolApproval[] = [];
const listeners = new Set<() => void>();
export type ToolApprovalDecision = boolean | 'always';
const decisions = new Map<string, (approved: ToolApprovalDecision) => void>();
const publish = () => { for (const listener of listeners) listener(); };
export const getToolApprovals = () => snapshot;
export const subscribeToolApprovals = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function decideToolApproval(id: string, approved: ToolApprovalDecision) { decisions.get(id)?.(approved); }

export function requestToolApproval(root: string, conversationId: string): RequestToolApproval {
  return async (request, signal) => {
    signal?.throwIfAborted();
    const frozenRequest = structuredClone(request);
    const permission = localAgentPermission(frozenRequest.toolName);
    if (permission && hasLocalAgentPermission(root, permission)) return true;
    let researchPapers: ResearchPaper[] | undefined;
    if (request.toolName === 'import_papers') {
      const ids = (frozenRequest.input as { paper_ids?: unknown } | null)?.paper_ids;
      if (!Array.isArray(ids) || !ids.length || !ids.every(id => typeof id === 'string')) {
        throw new AgentToolNotExecutedError(undefined, 'TOOL_INVALID_ARGUMENTS');
      }
      try { researchPapers = await previewResearchImport(root, ids); }
      catch {
        signal?.throwIfAborted();
        throw new AgentToolNotExecutedError(undefined, 'TOOL_PREFLIGHT_FAILED');
      }
      signal?.throwIfAborted();
      if (!researchPapers.some(paper => paper.pdf_url?.trim())) {
        throw new AgentToolNotExecutedError(undefined, 'TOOL_NO_PUBLIC_PDF');
      }
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (approved?: ToolApprovalDecision) => {
        if (!decisions.has(id)) return;
        if (approved === 'always') {
          signal?.throwIfAborted();
          if (!permission) throw new Error('此操作不支持长期授权。');
          allowLocalAgentPermission(root, permission);
        }
        if (!decisions.delete(id)) return;
        signal?.removeEventListener('abort', cancel);
        snapshot = snapshot.filter(item => item.id !== id);
        publish();
        if (approved === undefined) reject(signal?.reason ?? new AgentStoppedError('任务已停止，未执行待确认操作。'));
        else resolve(approved === true || approved === 'always');
      };
      const cancel = () => finish();
      decisions.set(id, finish);
      signal?.addEventListener('abort', cancel, { once: true });
      snapshot = [...snapshot, Object.freeze({ ...frozenRequest, id, root, conversationId, researchPapers })];
      publish();
    });
  };
}
