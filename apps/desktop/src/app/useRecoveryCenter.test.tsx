// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecoveryCenter } from './useRecoveryCenter';

const state = vi.hoisted(() => ({ drafts: new Map(), restorable: new Map(), pending: new Map(), loaded: true, unreadable: 0, error: null }));
vi.mock('@/shared/lib/editRecovery', () => ({
  subscribeEditRecovery: () => () => {}, editRecoveryVersion: () => 0,
  recoveryAvailable: () => true, recoveryState: () => state, loadEditRecovery: async () => {},
  flushEditRecovery: vi.fn(async () => {}), forgetEditRecovery: vi.fn(), requestEditRecovery: () => {},
}));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: () => 'id', dismiss: () => {} }) }));
afterEach(() => { cleanup(); state.drafts.clear(); state.restorable.clear(); });

it('does not show live autosave checkpoints as recoverable drafts', () => {
  state.drafts.set('active', { key: 'active', updatedAt: '2026-01-01', payload: {} });
  const view = render(<RecoveryCenter root="test" onOpen={() => {}} />);
  expect(screen.queryByRole('button', { name: /本地草稿/ })).toBeNull();
  state.restorable.set('old', { key: 'old', updatedAt: '2026-01-01', payload: {} });
  view.rerender(<RecoveryCenter root="test" onOpen={() => {}} />);
  expect(screen.getByRole('button', { name: '本地草稿 1' })).toBeTruthy();
});

it('removes only obsolete attribute-definition drafts', async () => {
  const { forgetEditRecovery } = await import('@/shared/lib/editRecovery');
  state.drafts.set('field', { key: 'field', kind: 'entry', targetId: 'field-definitions', updatedAt: '2026-01-01', payload: {} });
  state.drafts.set('note', { key: 'note', kind: 'entry', targetId: 'note', updatedAt: '2026-01-01', payload: {} });
  render(<RecoveryCenter root="test" onOpen={() => {}} />);
  expect(forgetEditRecovery).toHaveBeenCalledWith('test', 'field');
  expect(forgetEditRecovery).not.toHaveBeenCalledWith('test', 'note');
});
