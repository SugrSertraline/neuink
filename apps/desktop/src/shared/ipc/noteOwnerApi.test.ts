import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readOwnedNote, saveOwnedNote, buildOwnedNoteSourceLink, saveOwnedNoteAssetBytes, inspectTagNoteExport, exportTagNotes } from './noteOwnerApi';
import { noteOwnerKey } from '../lib/noteOwner';
import { resolveNoteImageSrc } from '@/modules/notes/editor/NoteImage';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => `asset:${path}` }));
beforeEach(() => invoke.mockReset());
describe('owned notes IPC and assets', () => {
  it('keeps existing note identities and entry commands compatible', async () => {
    const owner = { kind: 'entry' as const, entry_id: 'e1' };
    await readOwnedNote('root', { owner, note_id: 'n1' });
    expect(noteOwnerKey(owner)).toBe('e1');
    expect(invoke).toHaveBeenCalledWith('read_note', { request: { root: 'root', entry_id: 'e1', note_id: 'n1' } });
  });
  it('saves tag notes with explicit ownership and original revision, never a fake entry', async () => {
    const target = { owner: { kind: 'tag_reading' as const, tag_id: 't1' }, note_id: 'n1' };
    const document = { title: '综合', note_id: 'n1', markdown: '正文', links: [], revision: 'base-v1' };
    await saveOwnedNote('root', target, document);
    expect(invoke).toHaveBeenLastCalledWith('tag_note', { request: { root: 'root', tag_id: 't1', action: { kind: 'save', document } } });
    await buildOwnedNoteSourceLink('root', target, 'paper-b', 's2');
    expect(invoke).toHaveBeenLastCalledWith('tag_note', { request: { root: 'root', tag_id: 't1', action: { kind: 'build_source_link', note_id: 'n1', source_entry_id: 'paper-b', segment_uid: 's2' } } });
    await saveOwnedNoteAssetBytes('root', target.owner, 'n1', 'image/png', 'abc');
    expect(invoke.mock.calls[2][1].request.action).toMatchObject({ kind: 'save_asset', mime_type: 'image/png', data_base64: 'abc' });
  });
  it('resolves imported images and snapshots inside their actual owner directory', () => {
    expect(resolveNoteImageSrc('./n1.assets/img.png', { entryId: 'tag-reading:t1', noteId: 'n1', workspaceRoot: 'root', noteOwner: { kind: 'tag_reading', tag_id: 't1' } })).toBe('asset:root\\tag-reading\\t1\\notes\\n1.assets\\img.png');
    expect(resolveNoteImageSrc('./n1.assets/img.png', { entryId: 'e1', noteId: 'n1', workspaceRoot: 'root' })).toBe('asset:root\\entries\\e1\\notes\\n1.assets\\img.png');
  });
  it('uses the shared export selection and fingerprint contract for tags', async () => {
    await inspectTagNoteExport('root', 't1', 'n1');
    expect(invoke.mock.calls[0][1].request.action).toEqual({ kind: 'inspect_export', note_id: 'n1' });
    const options = { selected: [{ id: 'note:n1', fingerprint: 'v1' }], format: 'docx' as const, target_path: 'out.docx', allow_incomplete: false };
    await exportTagNotes('root', 't1', options);
    expect(invoke.mock.calls[1][1].request.action).toEqual({ kind: 'export', ...options });
  });
});
