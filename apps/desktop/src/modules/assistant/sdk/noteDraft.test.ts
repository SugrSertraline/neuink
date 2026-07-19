import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { readEntryAssistantContext } from '@/shared/ipc/assistantApi';
import { readNote } from '@/shared/ipc/workspaceApi';

import { citedEvidenceSources, generateNoteDraftProposal } from './noteDraft';

vi.mock('ai', () => ({ generateText: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', () => ({ readEntryAssistantContext: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ readNote: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('citedEvidenceSources', () => {
  it('keeps only valid source markers that appear in generated Markdown', () => {
    const sources = [source('segment-1'), source('segment-2'), source('segment-3')];

    const cited = citedEvidenceSources('Claim [S2]. Repeated [S2]. Unknown [S9].', sources);

    expect(cited.map((item) => item.marker)).toEqual([2]);
    expect(cited.map((item) => item.source.segment_uid)).toEqual(['segment-2']);
  });
});

describe('generateNoteDraftProposal', () => {
  it('does not inject the open PDF into a general-knowledge note append', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '$$E = mc^2$$' } as never);

    const result = await generateNoteDraftProposal({
      contextSnapshot: {
        active_entry: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          has_pdf: true,
          parse_status: 'succeeded'
        },
        active_note: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          markdown: '# Existing',
          markdown_char_count: 10,
          note_id: 'note-1',
          note_title: 'Generated note',
          source_link_count: 0,
          truncated: false
        },
        document: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          markdown: '# Unrelated paper [S1]',
          markdown_char_count: 22,
          sources: [source('segment-1')],
          truncated: false
        },
        pinned_segments: [],
        warnings: []
      },
      currentEntry: { id: 'entry-1', title: 'Paper' },
      currentNote: {
        entryId: 'entry-1',
        entryTitle: 'Paper',
        noteId: 'note-1',
        noteTitle: 'Generated note'
      },
      plan: {
        attachments: [],
        capabilities: ['read_note', 'synthesize', 'propose_note'],
        confidence: 1,
        deliverables: ['note_patch_proposal'],
        intent: 'note_update',
        missing: [],
        needsCurrentNote: true,
        needsDocumentContext: false,
        needsNoteProposal: true,
        needsSegmentSearch: false,
        noteAction: 'append',
        rationale: 'test',
        request: '在这个文档后面，追加一个质能方程',
        steps: [{ dependsOn: [], id: 'draft', kind: 'draft_note' }],
        target: { entryId: 'entry-1', kind: 'markdown_note', noteId: 'note-1' }
      },
      question: '在这个文档后面，追加一个质能方程',
      root: 'C:/workspace',
      scope: {
        entry_ids: ['entry-1'],
        entry_titles: ['Paper'],
        tag_ids: [],
        tag_names: []
      },
      settings: {
        api_key: 'test',
        base_url: 'http://localhost',
        id: 'test',
        max_context_length: 8192,
        max_output_tokens: 1024,
        model: 'test-model',
        name: 'Test',
        temperature: 0,
        top_p: 1
      }
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateText).mock.calls[0]?.[0].prompt).toContain(
      'Evidence:\nNo paper evidence was selected.'
    );
    expect(result.proposal.sources).toEqual([]);
  });

  it('loads the planned Markdown instead of using a different open note', async () => {
    vi.mocked(readNote).mockResolvedValue({
      links: [],
      markdown: '# Target Markdown',
      note_id: 'note-target',
      title: '完整目标名称'
    });
    vi.mocked(generateText).mockResolvedValue({ text: '# Revised target' } as never);

    const result = await generateNoteDraftProposal({
      assistantContext: null,
      contextSnapshot: {
        active_entry: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          has_pdf: true,
          parse_status: 'succeeded'
        },
        active_note: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          markdown: '# Wrong open note',
          markdown_char_count: 17,
          note_id: 'note-open',
          note_title: '另一个 Markdown',
          source_link_count: 0,
          truncated: false
        },
        document: null,
        pinned_segments: [],
        warnings: []
      },
      currentEntry: { id: 'entry-1', title: 'Paper' },
      currentNote: {
        entryId: 'entry-1',
        entryTitle: 'Paper',
        noteId: 'note-open',
        noteTitle: '另一个 Markdown'
      },
      plan: {
        attachments: [],
        capabilities: ['read_document', 'read_note', 'synthesize', 'propose_note'],
        confidence: 1,
        deliverables: ['note_patch_proposal'],
        intent: 'note_update',
        missing: [],
        needsCurrentNote: true,
        needsDocumentContext: true,
        needsNoteProposal: true,
        needsSegmentSearch: false,
        noteAction: 'patch',
        rationale: 'test',
        steps: [],
        target: { entryId: 'entry-1', kind: 'markdown_note', noteId: 'note-target' }
      },
      question: '完善《完整目标名称》',
      root: 'C:/workspace',
      scope: {
        entry_ids: ['entry-1'],
        entry_titles: ['Paper'],
        tag_ids: [],
        tag_names: []
      },
      settings: {
        api_key: 'test',
        base_url: 'http://localhost',
        id: 'test',
        max_context_length: 8192,
        max_output_tokens: 1024,
        model: 'test-model',
        name: 'Test',
        temperature: 0,
        top_p: 1
      }
    });

    expect(readNote).toHaveBeenCalledWith('C:/workspace', 'entry-1', 'note-target');
    expect(result.proposal.beforeMarkdown).toBe('# Target Markdown');
    expect(result.proposal.noteId).toBe('note-target');
    expect(result.proposal.noteTitle).toBe('完整目标名称');
  });

  it('reloads the complete Markdown when the active note snapshot is truncated', async () => {
    vi.mocked(readNote).mockResolvedValue({
      links: [],
      markdown: '# Complete Markdown\n\nLast section',
      note_id: 'note-1',
      title: 'Long note'
    });
    vi.mocked(generateText).mockResolvedValue({ text: 'New ending' } as never);

    const result = await generateNoteDraftProposal({
      contextSnapshot: {
        active_entry: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          has_pdf: true,
          parse_status: 'succeeded'
        },
        active_note: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          markdown: '# Truncated',
          markdown_char_count: 50_000,
          note_id: 'note-1',
          note_title: 'Long note',
          source_link_count: 0,
          truncated: true
        },
        document: null,
        pinned_segments: [],
        warnings: []
      },
      currentEntry: { id: 'entry-1', title: 'Paper' },
      currentNote: {
        entryId: 'entry-1',
        entryTitle: 'Paper',
        noteId: 'note-1',
        noteTitle: 'Long note'
      },
      plan: {
        attachments: [],
        capabilities: ['read_note', 'synthesize', 'propose_note'],
        confidence: 1,
        deliverables: ['note_patch_proposal'],
        intent: 'note_update',
        missing: [],
        needsCurrentNote: true,
        needsDocumentContext: false,
        needsNoteProposal: true,
        needsSegmentSearch: false,
        noteAction: 'append',
        rationale: 'test',
        steps: [],
        target: { entryId: 'entry-1', kind: 'markdown_note', noteId: 'note-1' }
      },
      question: '继续追加',
      root: 'C:/workspace',
      scope: {
        entry_ids: ['entry-1'],
        entry_titles: ['Paper'],
        tag_ids: [],
        tag_names: []
      },
      settings: {
        api_key: 'test',
        base_url: 'http://localhost',
        id: 'test',
        max_context_length: 8192,
        max_output_tokens: 1024,
        model: 'test-model',
        name: 'Test',
        temperature: 0,
        top_p: 1
      }
    });

    expect(readNote).toHaveBeenCalledWith('C:/workspace', 'entry-1', 'note-1');
    expect(result.proposal.beforeMarkdown).toContain('Last section');
  });

  it('keeps a reviewable proposal when citation repair still produces no marker', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '新增的分析内容。' } as never);

    const result = await generateNoteDraftProposal({
      contextSnapshot: {
        active_entry: {
          entry_id: 'entry-1',
          entry_title: 'Paper',
          has_pdf: true,
          parse_status: 'succeeded'
        },
        active_note: null,
        document: null,
        pinned_segments: [{
          entry_id: 'entry-1',
          entry_title: 'Paper',
          page_idx: 0,
          segment_uid: 'segment-1',
          text: 'Grounded evidence.',
          text_char_count: 18,
          truncated: false
        }],
        warnings: []
      },
      conversationHistory: [{
        content: '请整理这部分内容',
        created_at: new Date().toISOString(),
        message_id: 'user-1',
        role: 'user',
        source_links: []
      }],
      currentEntry: { id: 'entry-1', title: 'Paper' },
      plan: {
        attachments: [],
        capabilities: ['read_document', 'synthesize', 'propose_note'],
        confidence: 1,
        deliverables: ['note_create_proposal'],
        intent: 'note_create',
        missing: [],
        needsCurrentNote: false,
        needsDocumentContext: true,
        needsNoteProposal: true,
        needsSegmentSearch: false,
        noteAction: 'create',
        rationale: 'test',
        steps: [],
        target: { entryId: 'entry-1', kind: 'markdown_note' }
      },
      question: '继续追加一些内容',
      root: 'C:/workspace',
      scope: {
        entry_ids: ['entry-1'],
        entry_titles: ['Paper'],
        tag_ids: [],
        tag_names: []
      },
      settings: {
        api_key: 'test',
        base_url: 'http://localhost',
        id: 'test',
        max_context_length: 8192,
        max_output_tokens: 1024,
        model: 'test-model',
        name: 'Test',
        temperature: 0,
        top_p: 1
      }
    });

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain('未能自动匹配可靠来源引用');
    expect(result.proposal.markdown).toBe('新增的分析内容。');
    expect(result.sources).toEqual([]);
    expect(vi.mocked(generateText).mock.calls[0]?.[0].prompt).toContain('请整理这部分内容');
  });

  it('hydrates a retained source paper after the destination switches to a new Entry', async () => {
    vi.mocked(readEntryAssistantContext).mockResolvedValue({
      entry_id: 'paper-source',
      entry_title: 'Source Paper',
      markdown: 'The study found a measurable improvement [S1].',
      sources: [{
        entry_id: 'paper-source',
        entry_title: 'Source Paper',
        page_idx: 2,
        quote: 'The study found a measurable improvement.',
        segment_uid: 'segment-source'
      }]
    });
    vi.mocked(generateText).mockResolvedValue({
      text: '# 学习笔记\n\n论文报告了可测量的改进。[S1]'
    } as never);

    const result = await generateNoteDraftProposal({
      assistantContext: {
        items: [{
          addedAt: '',
          entryId: 'study-notes',
          entryTitle: '软件工程论文学习',
          id: 'entry:study-notes',
          kind: 'entry'
        }]
      },
      contextSnapshot: {
        active_entry: {
          entry_id: 'study-notes',
          entry_title: '软件工程论文学习',
          has_pdf: false,
          parse_status: null
        },
        active_note: null,
        document: null,
        pinned_segments: [],
        warnings: []
      },
      currentEntry: { id: 'study-notes', title: '软件工程论文学习' },
      plan: {
        attachments: [{
          attachmentId: 'entry:paper-source',
          entryId: 'paper-source',
          entryTitle: 'Source Paper',
          hydration: 'full_if_budget',
          kind: 'entry',
          reason: 'Retained source paper.',
          role: 'read'
        }],
        capabilities: ['read_document', 'synthesize', 'propose_note'],
        citationPolicy: 'required',
        confidence: 1,
        deliverables: ['note_create_proposal'],
        intent: 'note_create',
        missing: [],
        needsCurrentNote: false,
        needsDocumentContext: true,
        needsNoteProposal: true,
        needsSegmentSearch: false,
        noteAction: 'create',
        rationale: 'test',
        steps: [],
        target: { entryId: 'study-notes', kind: 'markdown_note' }
      },
      question: '阅读论文并整理学习笔记',
      root: 'C:/workspace',
      scope: {
        entry_ids: ['study-notes'],
        entry_titles: ['软件工程论文学习'],
        tag_ids: [],
        tag_names: []
      },
      settings: {
        api_key: 'test', base_url: 'http://localhost', id: 'test',
        max_context_length: 8192, max_output_tokens: 1024,
        model: 'test-model', name: 'Test', temperature: 0, top_p: 1
      }
    });

    expect(readEntryAssistantContext).toHaveBeenCalledWith({
      entryId: 'paper-source',
      root: 'C:/workspace'
    });
    expect(vi.mocked(generateText).mock.calls[0]?.[0].prompt).toContain(
      'Retained paper source: Source Paper'
    );
    expect(result.proposal.sources).toHaveLength(1);
    expect(result.proposal.sources[0].entryId).toBe('paper-source');
  });
});

function source(segmentUid: string): ConversationSourceLink {
  return {
    entry_id: 'entry-1',
    entry_title: 'Paper',
    page_idx: 0,
    quote: segmentUid,
    segment_uid: segmentUid
  };
}
