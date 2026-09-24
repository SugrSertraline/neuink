import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { CatalogNote, NoteCatalog } from '@/shared/ipc/noteCatalogApi';
import type { TagMeta } from '@/shared/types/domain';

// Isolated sample data, never loaded by the workspace or written to disk.
export const relationTags: TagMeta[] = [
  { id: 'software', name: '软件工程', description: '比较需求表达、代码生成和评测方法，整理跨论文的发现与证据。', parent_id: null, created_at: '', updated_at: '' },
  { id: 'alignment', name: '需求对齐', parent_id: 'software', created_at: '', updated_at: '' },
  { id: 'evaluation', name: '代码评测', parent_id: 'software', created_at: '', updated_at: '' },
  { id: 'hci', name: '人机交互', parent_id: null, created_at: '', updated_at: '' },
];
export const relationEntries: LibraryEntry[] = [
  { id: 'paper-a', title: 'Bridging the Gap between User Intent and LLM', tagIds: ['alignment', 'hci'], contents: [{ kind: 'note', note_id: 'summary', title: '需求表达：阅读记录' }] },
  { id: 'paper-b', title: 'SR-Eval: Stepwise Requirement Refinement', tagIds: ['evaluation', 'alignment'], contents: [] },
  { id: 'paper-c', title: 'SlopCodeBench: Evaluating Coding Agents', tagIds: ['evaluation'], contents: [] },
  { id: 'unclassified', title: '待整理的论文', tagIds: [], contents: [] },
].map(entry => ({ ...entry, tags: [], fields: { description: '用于关系图交互检查的示例论文。' }, createdAt: '', updatedAt: '', pdfFileName: `${entry.id}.pdf`, parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 } as LibraryEntry));
export const comparisonNote: CatalogNote = {
  target: { owner: { kind: 'tag_reading', tag_id: 'software' }, note_id: 'comparison' },
  title: '跨论文比较：需求如何影响代码质量', owner_title: '软件工程', updated_at: '', deleted_at: null, revision: '1', error: null,
  links: [{ link_id: 'link', anchor_id: 'anchor', owner: { kind: 'tag_note', tag_id: 'software', note_id: 'comparison' }, display_text: '对比三篇论文', created_at: '', sources: [
    { entry_id: 'paper-a', segment_uid: 'a1', quote_hash: 'a', page: 2, snapshot_text: '通过澄清用户意图，降低需求表达与模型理解之间的偏差。' },
    { entry_id: 'paper-b', segment_uid: 'b1', quote_hash: 'b', page: 4, snapshot_text: '逐步细化需求后，在不同评测任务中比较生成结果。' },
    { entry_id: 'deleted', segment_uid: 'd1', quote_hash: 'd', page: 3, snapshot_text: '这段引用在论文删除前已经保存，仍可作为阅读记录回查。' },
  ] }],
  source_statuses: [{ entry_id: 'deleted', segment_uid: 'd1', quote_hash: 'd', status: 'entry_deleted', message: '原论文已删除，保留引用快照', can_locate: false }],
};
export const relationCatalog: NoteCatalog = { notes: [comparisonNote], errors: [] };
