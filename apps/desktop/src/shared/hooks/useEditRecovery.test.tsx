// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEditRecovery } from './useEditRecovery';
import { EditRecoveryNotice } from '../components/EditRecoveryNotice';
import { flushEditRecovery, recoveryState } from '../lib/editRecovery';
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(async () => {}), remove: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../ipc/editRecoveryApi', () => ({ readEditRecovery: api.read, writeEditRecovery: api.write, removeEditRecovery: api.remove }));
afterEach(cleanup);
function Editor({ root }: { root: string }) {
  const [text, setText] = useState('canonical'), [saved, setSaved] = useState('canonical');
  const recovery = useEditRecovery({ root, dirty: text !== saved, draft: { key: 'note', kind: 'segment-note', label: 'Draft', ownerId: 'e', targetId: 's', scopeKey: 'pdf:e', payload: { text } },
    restore: value => setText(String(value.payload.text)) });
  return <><EditRecoveryNotice recovery={recovery} /><input aria-label="Editor" value={text} readOnly={recovery.loading || Boolean(recovery.pending)} onChange={event => setText(event.target.value)} /><button onClick={() => setSaved(text)}>Save</button></>;
}
it('does not erase a recovery draft during the external-store render before React commits the restored text', async () => {
  api.read.mockResolvedValueOnce({ unreadable: 0, drafts: [{ key: 'note', kind: 'segment-note', label: 'Draft', ownerId: 'e', targetId: 's', scopeKey: 'pdf:e', updatedAt: '2026-11-04T12:00:00Z', payload: { text: 'recovered unsaved text' } }] });
  render(<Editor root="restore-render" />);
  await screen.findByText('恢复到编辑器');
  expect((screen.getByLabelText('Editor') as HTMLInputElement).value).toBe('canonical');
  fireEvent.click(screen.getByText('恢复到编辑器'));
  expect((screen.getByLabelText('Editor') as HTMLInputElement).value).toBe('recovered unsaved text');
  await act(async () => flushEditRecovery('restore-render'));
  expect(recoveryState('restore-render').drafts.get('note')?.payload.text).toBe('recovered unsaved text');
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save'));
  await act(async () => flushEditRecovery('restore-render'));
  await waitFor(() => expect(recoveryState('restore-render').drafts.size).toBe(0));
  expect(api.remove).toHaveBeenCalledWith('restore-render', 'note');
});
