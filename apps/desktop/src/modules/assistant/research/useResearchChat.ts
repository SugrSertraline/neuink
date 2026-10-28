import { useEffect, useRef, useState } from 'react';
import type { ResearchModel } from './useResearchTasks';
import type { ResearchScopePreview, ResearchSelection, ResearchTask } from '@/shared/ipc/deepResearchApi';

export function useResearchChat(root: string | null, model: ResearchModel) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const current = useRef({ root, locked: false, generation: 0 });
  if (current.current.root !== root) current.current = { root, locked: false, generation: current.current.generation + 1 };
  useEffect(() => { setError(null); setSending(false); return () => { current.current.generation++; }; }, [root]);
  const send = async (query: string, profileId: string, selections: ResearchSelection[]) => {
    if (!root || current.current.locked || model.status?.active || model.status?.pending_save) return false;
    setError(null);
    if (!model.status?.ready) { setError('请先安装研究组件，问题会保留在输入框中。'); return false; }
    if (!query.trim() || !profileId) return false;
    const generation = current.current.generation, parentId = model.selected;
    const valid = () => current.current.root === root && current.current.generation === generation;
    current.current.locked = true; setSending(true);
    try {
      const scope = await model.command<ResearchScopePreview>({ kind: 'preview_scope', selections });
      if (!scope || !valid()) return false;
      const task = await model.command<ResearchTask>({ kind: 'start', id: crypto.randomUUID(), query: query.trim(), profile_id: profileId,
        parent_id: parentId, selections, scope_hash: scope.scope_hash });
      if (!task || !valid()) return false;
      model.select(task.id);
      return true;
    } catch (caught) { if (valid()) setError(String(caught)); return false; }
    finally { if (valid()) { current.current.locked = false; setSending(false); } }
  };
  return { send, error, setError, sending };
}
