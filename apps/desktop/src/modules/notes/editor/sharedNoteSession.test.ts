// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import { SourceLinkNode, insertSourceLinkNode } from './SourceLinkNode';
import { SharedNoteSession } from './sharedNoteSession';
import type { NoteDocument } from '@/shared/types/domain';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); });
const note: NoteDocument = { note_id: 'n', title: 'Title', markdown: 'Base', links: [], revision: '1' };
async function setup() {
  const session = new SharedNoteSession('workspace', 'Title');
  const save = vi.fn(async (title: string, markdown: string, links: NoteDocument['links']) => ({ ...note, title, markdown, links, revision: '2' }));
  const load = vi.fn(async () => note);
  session.configure({ save, load });
  const add = () => {
    const editor = new Editor({ extensions: [StarterKit, Markdown, Table, TableCell, TableHeader, TableRow, SourceLinkNode], content: '' });
    cleanups.push(() => editor.destroy());
    cleanups.push(session.attach({ editor, links: () => [], updateLinks: () => {} }));
    return editor;
  };
  const a = add(), b = add(); await session.load();
  return { session, save, load, a, b, add };
}
describe('shared note document sessions', () => {
  it('preserves tables and structured source atoms across views and undo', async () => {
    const { a, b } = await setup();
    a.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(b.getJSON()).toEqual(a.getJSON());
    insertSourceLinkNode(b, {
      anchor_id: 'sl-test', created_at: '', display_text: 'p.1', link_id: 'link-test',
      owner: { entry_id: 'e', kind: 'note', note_id: 'n' },
      sources: [{ entry_id: 'source', page: 1, quote_hash: '', segment_uid: 's', snapshot_text: 'Evidence' }]
    }, 'workspace');
    expect(a.getJSON()).toEqual(b.getJSON());
    expect(JSON.stringify(a.getJSON())).toContain('sourceLink');
    b.commands.undo(); expect(a.getJSON()).toEqual(b.getJSON());
  });
  it('syncs incremental edits both ways, maps undo, and seeds late views with the live draft', async () => {
    const { session, a, b, add } = await setup();
    a.commands.insertContentAt(5, ' A');
    expect(b.getText()).toBe('Base A');
    b.commands.insertContentAt(7, ' B');
    expect(a.getText()).toBe('Base A B');
    a.commands.undo();
    expect(a.getText()).toBe('Base B');
    expect(b.getText()).toBe(a.getText());
    a.commands.redo(); expect(b.getText()).toBe('Base A B');
    expect(add().getText()).toBe('Base A B');
    expect(session.getSnapshot().dirty).toBe(true);
  });
  it('serializes two save requests, keeps edits during save dirty and advances revision', async () => {
    const { session, a, b, load } = await setup();
    let resolve!: (note: NoteDocument) => void;
    const save = vi.fn(() => new Promise<NoteDocument>(done => { resolve = done; }));
    session.configure({ load, save });
    a.commands.insertContentAt(5, ' A');
    const first = session.save(), second = session.save();
    expect(save).toHaveBeenCalledOnce();
    b.commands.insertContentAt(7, ' B');
    resolve({ ...note, markdown: 'Base A', revision: '2' });
    expect(await first).toBe(false); expect(await second).toBe(false);
    expect(session.getSnapshot().dirty).toBe(true);
    const final = session.save();
    expect(save.mock.calls[1]).toEqual(['Title', 'Base A B', [], '2']);
    resolve({ ...note, markdown: 'Base A B', revision: '3' });
    expect(await final).toBe(true);
  });
  it('does not overwrite dirty content on refresh and resolves explicit conflict in all views', async () => {
    const { session, a, b, save } = await setup();
    a.commands.insertContentAt(5, ' local');
    session.configure({ save, load: async () => ({ ...note, revision: 'external', markdown: 'External' }) });
    await session.load(true);
    expect(b.getText()).toBe('Base local');
    expect(session.getSnapshot().conflict?.remote.revision).toBe('external');
    session.acceptRemote();
    expect(a.getText()).toBe('External'); expect(b.getText()).toBe('External');
    expect(session.getSnapshot().dirty).toBe(false);
  });
  it('failure preserves both drafts, discard restores both and detached views stop receiving', async () => {
    const { session, a, b, load } = await setup();
    session.configure({ load, save: async () => { throw new Error('disk failed'); } });
    a.commands.insertContentAt(5, ' A');
    expect(await session.save()).toBe(false); expect(b.getText()).toBe('Base A');
    session.discard(); expect(a.getText()).toBe('Base'); expect(b.getText()).toBe('Base');
    expect(session.getSnapshot().dirty).toBe(false);
  });
});
