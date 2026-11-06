import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { writeEditRecovery } from './editRecoveryApi';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({ drafts: [], unreadable: 0 })) }));
it('sends secrets separately from the on-disk draft representation', async () => {
  await writeEditRecovery('root', { key: 'settings', kind: 'settings', label: 'settings', ownerId: '', targetId: '', scopeKey: '', updatedAt: '', payload: { value: { endpoint: 'local' } }, secrets: { apiKey: 'test-only' } });
  const request = vi.mocked(invoke).mock.calls[0][1] as { request: { action: { draft: object; secrets: object } } };
  expect(JSON.stringify(request.request.action.draft)).not.toContain('test-only'); expect(request.request.action.secrets).toEqual({ apiKey: 'test-only' });
});
