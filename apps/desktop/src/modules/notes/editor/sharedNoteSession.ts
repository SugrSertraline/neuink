import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { Step } from '@tiptap/pm/transform';
import type { NoteDocument, SourceLink } from '@/shared/types/domain';
import { dematerializeMarkdownSourceLinks, getMarkdownWithSourceLinks, hydrateSourceLinkNodes, pruneUnusedSourceLinks } from './SourceLinkNode';

export type NoteConflict = { localLinks: SourceLink[]; localMarkdown: string; localTitle: string; remote: NoteDocument };
export type NoteSaveOptions = { expectedRevisionOverride?: string; quiet?: boolean; titleOverride?: string };
type IO = { load: () => Promise<NoteDocument>; save: (title: string, markdown: string, links: SourceLink[], revision?: string | null) => Promise<NoteDocument> };
type Peer = { editor: Editor; links: () => SourceLink[]; updateLinks: (links: SourceLink[]) => void };
type Snapshot = { title: string; dirty: boolean; saving: boolean; loading: boolean; loadFailed: boolean; error: string | null; conflict: NoteConflict | null; version: number };
const REMOTE = 'neuink-shared-note';

/** One document and one persistence queue per workspace/owner/note. Each mounted
 * editor keeps its own selection and history; synchronous PM steps map both.
 * This is a same-window session, not a cross-process collaboration protocol.
 */
export class SharedNoteSession {
  private state: Snapshot;
  private listeners = new Set<() => void>();
  private peers = new Set<Peer>();
  private doc: ProseMirrorNode | null = null;
  private note: NoteDocument | null = null;
  private links: SourceLink[] = [];
  private baseline = '';
  private muted = false;
  private loadPromise: Promise<void> | null = null;
  private savePromise: Promise<boolean> | null = null;
  private io: IO | null = null;
  private initialized = new Set<Peer>();
  private expectedDocs = new Map<Peer, ProseMirrorNode>();
  private insertions = new Set<string>();
  runInsertionOnce = (id: string, insert: () => void) => {
    if (this.insertions.has(id)) return false;
    insert(); this.insertions.add(id);
    if (this.insertions.size > 256) this.insertions.delete(this.insertions.values().next().value!);
    return true;
  };
  constructor(readonly workspace: string | null, title: string) {
    this.state = { title, dirty: false, saving: false, loading: true, loadFailed: false, error: null, conflict: null, version: 0 };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    this.listeners.forEach(listener => listener());
  }
  configure(io: IO) { this.io = io; }
  private markdown() {
    const peer = [...this.peers].find(p => this.initialized.has(p) && !p.editor.isDestroyed);
    return peer ? dematerializeMarkdownSourceLinks(getMarkdownWithSourceLinks(peer.editor), this.links) : this.baseline;
  }
  private updateDirty() {
    const markdown = this.markdown();
    this.publish({ dirty: markdown !== this.baseline || this.state.title !== this.note?.title,
      conflict: this.state.conflict ? { ...this.state.conflict, localMarkdown: markdown, localLinks: this.links, localTitle: this.state.title } : null });
  }
  private withMuted(fn: () => void) { this.muted = true; try { fn(); } finally { this.muted = false; } }
  private initialize(peer: Peer) {
    if (!this.note || this.initialized.has(peer)) return;
    this.withMuted(() => {
      if (this.doc) peer.editor.commands.setContent(this.doc.toJSON(), { emitUpdate: false });
      else {
        peer.editor.commands.setContent(dematerializeMarkdownSourceLinks(this.note!.markdown, this.links), { contentType: 'markdown', emitUpdate: false });
        hydrateSourceLinkNodes(peer.editor, this.links, this.workspace);
        this.doc = peer.editor.state.doc;
        this.baseline = dematerializeMarkdownSourceLinks(getMarkdownWithSourceLinks(peer.editor), this.links);
      }
      peer.updateLinks(this.links);
      // Loading/accepting a snapshot is not an undoable user edit. Reset the
      // local history at that explicit boundary, never during live replication.
      const state = peer.editor.state;
      peer.editor.view.updateState(EditorState.create({ schema: state.schema, doc: state.doc, plugins: state.plugins }));
      this.expectedDocs.set(peer, peer.editor.state.doc);
      this.initialized.add(peer);
    });
  }
  attach(peer: Peer) {
    this.peers.add(peer); this.initialize(peer);
    const receive = ({ transaction, appendedTransactions = [] }: { transaction: Transaction; appendedTransactions?: Transaction[] }) => {
      const transactions = [transaction, ...appendedTransactions];
      if (this.muted || transaction.getMeta(REMOTE) || !transactions.some(tr => tr.docChanged) || !this.initialized.has(peer)) return;
      // All writers are on the same JS thread. Never overwrite a divergent view.
      const expected = this.expectedDocs.get(peer);
      if (expected && !transaction.before.eq(expected)) {
        this.publish({ error: '笔记视图不同步，已停止编辑。请先备份当前草稿，再重新打开。', loadFailed: true, dirty: true });
        for (const target of this.peers) target.editor.setEditable(false);
        return;
      }
      this.doc = peer.editor.state.doc;
      this.expectedDocs.set(peer, this.doc);
      this.links = [...new Map([...this.links, ...peer.links()].map(link => [link.link_id, link])).values()];
      for (const target of this.peers) {
        target.updateLinks(this.links);
        if (target === peer || !this.initialized.has(target)) continue;
        const tr = target.editor.state.tr.setMeta(REMOTE, true).setMeta('addToHistory', false);
        for (const step of transactions.flatMap(item => item.steps)) tr.step(Step.fromJSON(target.editor.schema, step.toJSON()));
        target.editor.view.dispatch(tr);
        this.expectedDocs.set(target, target.editor.state.doc);
      }
      this.updateDirty();
    };
    peer.editor.on('transaction', receive);
    return () => { peer.editor.off('transaction', receive); this.peers.delete(peer); this.initialized.delete(peer); this.expectedDocs.delete(peer); };
  }
  async load(refresh = false) {
    if (this.loadPromise) return this.loadPromise;
    if (this.note && !refresh) return;
    const version = this.state.version;
    const operation = (async () => {
      try {
        const note = await this.io!.load();
        if (this.state.saving) return;
        if (this.note && (this.state.dirty || this.state.version !== version)) {
          if (note.revision !== this.note.revision) this.publish({ error: '笔记在其他位置发生了修改，请处理版本冲突。', conflict: { localLinks: this.links, localMarkdown: this.markdown(), localTitle: this.state.title, remote: note } });
          return;
        }
        if (this.note?.revision === note.revision) return;
        this.accept(note);
      } catch (error) { this.publish({ error: String(error instanceof Error ? error.message : error), loadFailed: !this.note }); }
      finally { this.publish({ loading: false }); }
    })();
    this.loadPromise = operation;
    try { await operation; } finally { if (this.loadPromise === operation) this.loadPromise = null; }
  }
  private accept(note: NoteDocument) {
    this.note = note; this.links = note.links; this.doc = null; this.baseline = note.markdown;
    this.initialized.clear(); this.expectedDocs.clear();
    for (const peer of this.peers) this.initialize(peer);
    this.publish({ title: note.title, dirty: false, loadFailed: false, error: null, conflict: null });
  }
  setTitle(title: string) { this.publish({ title }); this.updateDirty(); }
  changed() {
    if (this.muted || this.state.loading || !this.note) return;
    // Source-link metadata can arrive in onUpdate after the document transaction.
    this.links = [...new Map([...this.links, ...[...this.peers].flatMap(p => p.links())].map(link => [link.link_id, link])).values()];
    for (const peer of this.peers) peer.updateLinks(this.links);
    this.updateDirty();
  }
  async save(options: NoteSaveOptions = {}): Promise<boolean> {
    if (this.savePromise) return this.savePromise;
    if (!this.note || this.state.loading || this.state.loadFailed) return false;
    if (!this.state.dirty && options.quiet && !options.expectedRevisionOverride) return true;
    const title = (options.titleOverride ?? this.state.title).trim() || '未命名笔记';
    const markdown = this.markdown();
    const links = pruneUnusedSourceLinks(markdown, this.links);
    this.publish({ saving: true, error: null });
    const operation = (async () => {
      try {
        const saved = await this.io!.save(title, markdown, links, options.expectedRevisionOverride ?? this.note!.revision);
        this.note = saved; this.baseline = markdown;
        this.links = [...new Map([...saved.links, ...this.links].map(link => [link.link_id, link])).values()];
        for (const peer of this.peers) peer.updateLinks(this.links);
        if (this.state.title.trim() === title || !this.state.title.trim()) this.publish({ title: saved.title });
        this.publish({ conflict: null }); this.updateDirty();
        return !this.state.dirty;
      } catch (error) {
        this.publish({ error: String(error).includes('note changed after it was opened')
          ? '笔记已在其他位置被修改。当前草稿仍保留，请先通过“文件操作 → 另存为”备份，再重新打开笔记处理冲突。'
          : error instanceof Error ? error.message : String(error) });
        if (String(error).includes('note changed after it was opened')) {
          try { const remote = await this.io!.load(); this.publish({ conflict: { localLinks: this.links, localMarkdown: this.markdown(), localTitle: this.state.title, remote } }); }
          catch { /* Preserve the original save failure and local draft. */ }
        }
        return false;
      } finally { this.publish({ saving: false }); }
    })();
    this.savePromise = operation;
    try { return await operation; } finally { if (this.savePromise === operation) this.savePromise = null; }
  }
  discard() { if (this.note && !this.state.saving) this.accept(this.note); }
  acceptRemote() { if (this.state.conflict && !this.state.saving) this.accept(this.state.conflict.remote); }
}

const sessions = new Map<string, { session: SharedNoteSession; users: number }>();
export function getSharedNoteSession(key: string, workspace: string | null, title: string) {
  let record = sessions.get(key);
  if (!record) { record = { session: new SharedNoteSession(workspace, title), users: 0 }; sessions.set(key, record); }
  return record.session;
}
export function retainSharedNoteSession(key: string, session: SharedNoteSession) {
  const record = sessions.get(key)!; record.users++;
  return () => { record.users--; queueMicrotask(() => {
    if (record.users) return;
    const check = () => {
      const state = session.getSnapshot();
      if (record.users || (!state.dirty && !state.saving)) {
        unsubscribe();
        if (!record.users && sessions.get(key) === record) sessions.delete(key);
      }
    };
    const unsubscribe = session.subscribe(check);
    check();
  }); };
}
