import { expect, it } from 'vitest';
import { researchDockTask, RESEARCH_DOCK_ID } from './researchTaskDock';
import type { ResearchStatus } from '@/shared/ipc/deepResearchApi';

const ready: ResearchStatus = { ready: true, version: '0.16.1', error: null, pending_save: false, active: null };
it('projects one native research task and excludes tasks belonging to another workspace', () => {
  expect(researchDockTask({ ...ready, active: { id: null, stage: '正在研究', installation: false } }, [])).toEqual([]);
  const tasks = researchDockTask({ ...ready, active: { id: 'one', stage: '正在取消', installation: false } }, []);
  expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ id: RESEARCH_DOCK_ID, category: 'research', status: 'stopping', canStop: true });
});
it('keeps an unsaved completed report visible as waiting for the user', () => {
  const tasks = researchDockTask({ ...ready, pending_save: true, pending_task_id: 'one' }, [{ id: 'one', query: 'Compare methods', status: 'running', stage: 'Writing', model: 'model', created_at: '', error: null }]);
  expect(tasks[0]).toMatchObject({ question: 'Compare methods', status: 'waiting', canStop: false, canOpen: true });
});
