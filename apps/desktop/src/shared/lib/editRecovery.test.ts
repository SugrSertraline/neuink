// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { checkpointEditRecovery, flushEditRecovery, forgetEditRecovery, isRecoveryBackedUp, loadEditRecovery, recoveryState } from './editRecovery';
import type { EditRecoveryDraft } from '../ipc/editRecoveryApi';
const api = vi.hoisted(() => ({ read: vi.fn(async () => ({ drafts: [] as EditRecoveryDraft[], unreadable: 0 })), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));
vi.mock('../ipc/editRecoveryApi', () => ({ readEditRecovery: api.read, writeEditRecovery: api.write, removeEditRecovery: api.remove }));
const snapshot = { key: 'note', kind: 'note' as const, label: 'Test', ownerId: 'entry', targetId: 'note', scopeKey: 'note:entry:note', payload: { markdown: 'first' } };

it('serializes in-flight edits and discard without resurrecting a removed draft', async () => {
  const root = 'race';
  let finish!: () => void;
  api.write.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  checkpointEditRecovery(root, snapshot);
  const writing = flushEditRecovery(root);
  await vi.waitFor(() => expect(finish).toBeDefined());
  checkpointEditRecovery(root, { ...snapshot, payload: { markdown: 'latest' } });
  forgetEditRecovery(root, snapshot.key);
  finish(); await writing;
  expect(api.remove).toHaveBeenCalledWith(root, snapshot.key);
  expect(recoveryState(root).drafts.size).toBe(0);
  expect(recoveryState(root).pending.size).toBe(0);
});
it('keeps the newest edit after a failed write and retries it', async () => {
  const root = 'failure';
  api.write.mockRejectedValueOnce(new Error('disk full'));
  checkpointEditRecovery(root, snapshot);
  await expect(flushEditRecovery(root)).rejects.toThrow('备份失败');
  expect(isRecoveryBackedUp(root, snapshot.key)).toBe(false);
  checkpointEditRecovery(root, { ...snapshot, payload: { markdown: 'retry newest' } });
  await flushEditRecovery(root);
  expect(api.write).toHaveBeenLastCalledWith(root, expect.objectContaining({ payload: { markdown: 'retry newest' } }));
  expect(isRecoveryBackedUp(root, snapshot.key)).toBe(true);
});
it('does not replace edits with a late disk snapshot, or treat live checkpoints as restart recovery', async () => {
  const root = 'late-load';
  let finish!: (value: { drafts: EditRecoveryDraft[]; unreadable: number }) => void;
  api.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const loading = loadEditRecovery(root);
  checkpointEditRecovery(root, { ...snapshot, payload: { markdown: 'current session' } });
  finish({ drafts: [{ ...snapshot, updatedAt: '2026-11-04T12:00:00Z' }], unreadable: 0 });
  await loading; await flushEditRecovery(root);
  expect(recoveryState(root).drafts.get(snapshot.key)?.payload.markdown).toBe('current session');
  expect(recoveryState(root).restorable.size).toBe(0);
});
