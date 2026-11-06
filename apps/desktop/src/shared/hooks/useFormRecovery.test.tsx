// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditRecoveryRoot, useFormRecovery } from './useFormRecovery';
import { useSettingsAutosave } from '@/modules/settings/useSettingsAutosave';
import { flushEditRecovery, recoveryDraftKey, recoveryState, requestEditRecovery } from '../lib/editRecovery';
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async () => {}), remove: vi.fn(async () => {}), secrets: vi.fn(), save: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../ipc/editRecoveryApi', () => ({ readEditRecovery: api.read, writeEditRecovery: api.write, removeEditRecovery: api.remove, readEditRecoverySecrets: api.secrets }));
beforeEach(() => { vi.clearAllMocks(); api.read.mockResolvedValue({ drafts: [], unreadable: 0 }); });
afterEach(cleanup);
function Form({ root }: { root: string }) {
  const [value, setValue] = useState({ address: 'saved', apiKey: '' });
  const recovery = useFormRecovery({ root, id: 'service', label: 'Service', value, secretFields: ['apiKey'], dirty: value.address !== 'saved' || Boolean(value.apiKey), restore: setValue });
  return <>{recovery.notice}<input aria-label="Address" disabled={recovery.blocked} value={value.address} onChange={e => setValue({ ...value, address: e.target.value })} />
    <input aria-label="Key" type="password" disabled={recovery.blocked} value={value.apiKey} onChange={e => setValue({ ...value, apiKey: e.target.value })} />
    <button onClick={() => { recovery.discard(); setValue({ address: 'saved', apiKey: '' }); }}>Discard</button></>;
}
const snapshot = () => ({ key: recoveryDraftKey('settings', 'settings', 'service'), kind: 'settings', label: 'Service', ownerId: 'settings', targetId: 'service', scopeKey: 'settings',
  updatedAt: '2026-11-04T13:00:00Z', payload: { value: { address: 'recovered' } }, secretRef: 'protected-reference' });
it('keeps credentials out of the public payload, then clears the recovery on explicit discard', async () => {
  render(<Form root="secret-write" />);
  await waitFor(() => expect((screen.getByLabelText('Key') as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'test-private-key' } });
  await act(async () => flushEditRecovery('secret-write'));
  const stored = api.write.mock.calls[api.write.mock.calls.length - 1] as unknown as [string, { payload: object; secrets: object }];
  expect(JSON.stringify(stored[1].payload)).not.toContain('test-private-key');
  expect(stored[1].secrets).toEqual({ apiKey: 'test-private-key' });
  fireEvent.click(screen.getByText('Discard')); await act(async () => flushEditRecovery('secret-write'));
  expect(recoveryState('secret-write').drafts.size).toBe(0);
});
it('retrieves credentials only on explicit restore and preserves restored edits until saved', async () => {
  api.read.mockResolvedValue({ unreadable: 0, drafts: [snapshot()] }); api.secrets.mockResolvedValue({ apiKey: 'restored-secret' });
  render(<Form root="secret-restore" />); await screen.findByText('恢复到编辑器');
  expect(api.secrets).not.toHaveBeenCalled(); expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByText('恢复到编辑器'));
  await waitFor(() => expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('restored-secret'));
  await act(async () => flushEditRecovery('secret-restore'));
  expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('recovered');
  expect(recoveryState('secret-restore').drafts.size).toBe(1); expect(api.remove).not.toHaveBeenCalled();
});
it('keeps the previous draft and form intact when the OS vault cannot unlock', async () => {
  api.read.mockResolvedValue({ unreadable: 0, drafts: [snapshot()] }); api.secrets.mockRejectedValue(new Error('locked'));
  render(<Form root="secret-failure" />); fireEvent.click(await screen.findByText('恢复到编辑器'));
  await screen.findByText(/草稿或安全凭据无法恢复/);
  expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe('saved'); expect(api.remove).not.toHaveBeenCalled();
  expect(recoveryState('secret-failure').restorable.size).toBe(1);
});
function AutoForm() {
  const [value, setValue] = useState('saved'), [saved, setSaved] = useState('saved');
  const status = useSettingsAutosave({ value, savedValue: saved, equal: Object.is, save: api.save, onSaved: setSaved,
    recovery: { id: 'auto', label: 'auto', targetId: 'auto', restore: setValue } });
  return <>{status.notice}<span>{value}</span></>;
}
it('requires confirmation before autosaving restored settings', async () => {
  api.read.mockResolvedValue({ unreadable: 0, drafts: [{ ...snapshot(), key: recoveryDraftKey('settings', 'settings', 'auto'), targetId: 'auto', secretRef: null, payload: { value: { value: 'recovered setting' } } }] });
  render(<EditRecoveryRoot.Provider value="auto-restore"><AutoForm /></EditRecoveryRoot.Provider>);
  fireEvent.click(await screen.findByText('恢复到编辑器'));
  await screen.findByText('recovered setting');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('应用恢复设置')); await waitFor(() => expect(api.save).toHaveBeenCalledWith('recovered setting'));
  await act(async () => flushEditRecovery('auto-restore')); expect(recoveryState('auto-restore').drafts.size).toBe(0);
});
it('does not apply one service draft to other forms in the same settings section', async () => {
  const original = { ...snapshot(), targetId: 'parser-service', secretRef: null, payload: { value: 'first' } };
  api.read.mockResolvedValue({ unreadable: 0, drafts: [original] });
  function Forms() {
    const a = useFormRecovery({ root: 'same-section', id: 'service', targetId: 'parser-service', label: 'first', value: '', dirty: false, restore: () => {} });
    const b = useFormRecovery({ root: 'same-section', id: 'different', targetId: 'parser-service', label: 'second', value: '', dirty: false, restore: () => {} });
    return <><span>{a.pending ? 'first pending' : 'first empty'}</span><span>{b.pending ? 'second pending' : 'second empty'}</span></>;
  }
  render(<Forms />); await screen.findByText('first pending');
  act(() => requestEditRecovery('same-section', original.key));
  expect(screen.getByText('second empty')).toBeTruthy();
});
