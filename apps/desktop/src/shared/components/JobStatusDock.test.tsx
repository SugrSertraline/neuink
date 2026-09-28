// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { Job } from '@/shared/ipc/workspaceApi';
import { JobStatusDock } from './JobStatusDock';

afterEach(cleanup);
it.each(['paused', 'canceled'] as const)('distinguishes %s without showing running animation', status => {
  const job: Job = { id: 'j', kind: 'translation', status, scope: null, created_at: '', updated_at: '', error: null, message: null,
    progress: { current: 1, total: 2, percent: 50 } };
  const view = render(<JobStatusDock activeCount={0} jobs={[job]} />);
  expect(view.getByRole('button', { name: status === 'paused' ? '1 个任务已暂停' : '最近任务已取消' })).toBeTruthy();
  expect(view.container.querySelector('.animate-spin')).toBeNull();
});
