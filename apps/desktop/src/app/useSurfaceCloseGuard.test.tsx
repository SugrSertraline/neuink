// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSurfaceCloseGuard, type SurfaceCloseTarget } from './useSurfaceCloseGuard';
import { hasUnsavedSegmentEditors, registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { clearMarkdownNoteDirty, registerMarkdownNoteSaveHandler, setMarkdownNoteDirty } from '@/modules/notes/editor/noteDirtyRegistry';
import { saveEditsBeforeWorkspaceChange } from './editSafety';

const disposers: (() => void)[] = [];
afterEach(() => { cleanup(); disposers.splice(0).forEach((dispose) => dispose()); clearMarkdownNoteDirty('a', 'note'); });
const targets: SurfaceCloseTarget[] = [{ pane: 'left', surface: { kind: 'pdf', entryId: 'a' } }, { pane: 'right', surface: { kind: 'note', entryId: 'a', noteId: 'note' } }];
function Harness({ onClose, root = 'workspace', currentTargets = targets }: { onClose: (targets: SurfaceCloseTarget[]) => void; root?: string; currentTargets?: SurfaceCloseTarget[] }) {
  const guard = useSurfaceCloseGuard({ root, onClose });
  return <><button onClick={() => guard.requestClose(currentTargets)}>关闭页面</button>{guard.dialog}</>;
}
function dirtySegment(save: () => Promise<boolean>, discard = vi.fn()) {
  setSegmentEditorDirty('entry-content:a|pdf', 'owner', true);
  const dispose = registerSegmentEditorCloseHandler('entry-content:a|pdf', 'owner', { save, discard });
  disposers.push(() => { dispose(); setSegmentEditorDirty('pdf:a', 'owner', false); });
  return discard;
}
function dirtyNote(save: () => Promise<boolean>) {
  setMarkdownNoteDirty('a', 'note', 'owner', true);
  disposers.push(registerMarkdownNoteSaveHandler('a', 'note', 'owner', save));
}

it('closes clean targets immediately without writing', () => {
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('关闭页面'));
  expect(onClose).toHaveBeenCalledWith(targets);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps the entire batch open when any save fails and allows retry', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockImplementation(async () => { clearMarkdownNoteDirty('a', 'note'); return true; });
  dirtySegment(async () => true);
  dirtyNote(save);
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('关闭页面'));
  fireEvent.click(screen.getByText('保存并关闭'));
  await screen.findByRole('alert');
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('保存并关闭'));
  await waitFor(() => expect(onClose).toHaveBeenCalledWith(targets));
});

it('does not close a note whose save callback succeeded but newer edits remain', async () => {
  dirtyNote(async () => true);
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('关闭页面'));
  fireEvent.click(screen.getByText('保存并关闭'));
  await screen.findByRole('alert');
  expect(onClose).not.toHaveBeenCalled();
});

it('cancel preserves drafts, while explicit discard never calls save', () => {
  const save = vi.fn().mockResolvedValue(true);
  const discard = dirtySegment(save);
  const onClose = vi.fn();
  render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('关闭页面'));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  expect(hasUnsavedSegmentEditors('pdf:a')).toBe(true);
  fireEvent.click(screen.getByText('关闭页面'));
  fireEvent.click(screen.getByText('不保存并关闭'));
  expect(discard).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledWith(targets);
});

it('freezes the batch before async saves and ignores duplicate save clicks', async () => {
  let finish!: (saved: boolean) => void;
  const save = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  dirtySegment(save);
  const onClose = vi.fn();
  const view = render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('关闭页面'));
  fireEvent.click(screen.getByText('保存并关闭'));
  fireEvent.click(screen.getByText('保存中…'));
  view.rerender(<Harness onClose={onClose} currentTargets={[...targets, { pane: 'left', surface: { kind: 'library' } }]} />);
  await act(async () => finish(true));
  expect(save).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledWith(targets);
});

it('ignores a late save response after the workspace changes', async () => {
  let finish!: (saved: boolean) => void;
  dirtySegment(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const onClose = vi.fn();
  const view = render(<Harness onClose={onClose} />);
  fireEvent.click(screen.getByText('关闭页面'));
  fireEvent.click(screen.getByText('保存并关闭'));
  view.rerender(<Harness onClose={onClose} root="different" />);
  await act(async () => finish(true));
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('saves fragments and notes before switching workspaces, and rejects failed saves', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  dirtySegment(save);
  dirtyNote(async () => { clearMarkdownNoteDirty('a', 'note'); return true; });
  await expect(saveEditsBeforeWorkspaceChange()).rejects.toThrow('已取消切换资料库');
  await expect(saveEditsBeforeWorkspaceChange()).resolves.toBeUndefined();
});

it('protects both nested readers before a tag queue transition without closing the parent tab', async () => {
  const close = vi.fn(), transition = vi.fn(), saveA = vi.fn().mockResolvedValue(true);
  const saveB = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
  for (const [scope, save] of [['tag-reading:tag/pdf:a', saveA], ['tag-reading:tag/reflow:b', saveB]] as const) {
    setSegmentEditorDirty(scope, 'editor', true);
    const unregister = registerSegmentEditorCloseHandler(scope, 'editor', { save, discard: () => {} });
    disposers.push(() => { unregister(); setSegmentEditorDirty(scope, 'editor', false); });
  }
  function Transition() {
    const guard = useSurfaceCloseGuard({ root: 'workspace', onClose: close });
    return <><button onClick={() => guard.requestClose([{ pane: 'left', surface: { kind: 'tag-reading', tagId: 'tag' } }], transition)}>下一篇</button>{guard.dialog}</>;
  }
  render(<Transition />);
  fireEvent.click(screen.getByText('下一篇'));
  fireEvent.click(screen.getByText('取消'));
  expect(transition).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('下一篇'));
  fireEvent.click(screen.getByText('保存并继续'));
  await screen.findByRole('alert');
  expect(transition).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('保存并继续'));
  await waitFor(() => expect(transition).toHaveBeenCalledOnce());
  expect(close).not.toHaveBeenCalled();
  expect(saveA).toHaveBeenCalledOnce();
});
