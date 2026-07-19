import { describe, expect, it } from 'vitest';

import { buildEntryMetaProposal } from './entryMetaProposal';

describe('buildEntryMetaProposal', () => {
  it('captures exact before and after metadata with source evidence', () => {
    const proposal = buildEntryMetaProposal(
      {
        description: 'A concise paper about reliable agents.',
        source_markers: ['S1'],
        title: 'Reliable Agent Workflows'
      },
      {
        entries: [{
          description: 'Old description',
          id: 'entry-1',
          title: 'old.pdf',
          updatedAt: '2026-07-14T00:00:00Z'
        }],
        plan: {
          attachments: [], capabilities: [], citationPolicy: 'required', confidence: 1,
          deliverables: ['entry_meta_change_proposal'],
          entryMetaChange: { entryId: 'entry-1', fields: ['title', 'description'] },
          intent: 'entry_meta_update', missing: [], needsCurrentNote: false,
          needsDocumentContext: true, needsNoteProposal: false,
          needsSegmentSearch: false, rationale: '', steps: [],
          target: { entryId: 'entry-1', kind: 'entry_meta' }
        },
        sourceByMarker: new Map([[1, {
          entry_id: 'entry-1', entry_title: 'old.pdf', page_idx: 0,
          quote: 'Reliable agent workflows', segment_uid: 'segment-1'
        }]])
      }
    );

    expect(proposal).toMatchObject({
      afterDescription: 'A concise paper about reliable agents.',
      afterTitle: 'Reliable Agent Workflows',
      beforeDescription: 'Old description',
      beforeTitle: 'old.pdf',
      baseUpdatedAt: '2026-07-14T00:00:00Z',
      entryId: 'entry-1',
      status: 'pending'
    });
    expect(proposal.sources).toHaveLength(1);
  });

  it('preserves fields that the user did not request', () => {
    const proposal = buildEntryMetaProposal(
      { title: 'New title' },
      {
        entries: [{ description: 'Keep me', id: 'entry-1', title: 'Old', updatedAt: 'v1' }],
        plan: {
          attachments: [], capabilities: [], confidence: 1,
          deliverables: ['entry_meta_change_proposal'],
          entryMetaChange: { entryId: 'entry-1', fields: ['title'] },
          intent: 'entry_meta_update', missing: [], needsCurrentNote: false,
          needsDocumentContext: false, needsNoteProposal: false,
          needsSegmentSearch: false, rationale: '', steps: [],
          target: { entryId: 'entry-1', kind: 'entry_meta' }
        },
        sourceByMarker: new Map()
      }
    );

    expect(proposal.afterDescription).toBe('Keep me');
  });

  it('binds a paper-derived title to the best target source when the model omits markers', () => {
    const proposal = buildEntryMetaProposal(
      { title: 'Reliable Agent Workflows' },
      {
        entries: [{ description: '', id: 'entry-1', title: 'old.pdf', updatedAt: 'v1' }],
        plan: {
          attachments: [], capabilities: [], citationPolicy: 'required', confidence: 1,
          deliverables: ['entry_meta_change_proposal'],
          entryMetaChange: { entryId: 'entry-1', fields: ['title'] },
          intent: 'entry_meta_update', missing: [], needsCurrentNote: false,
          needsDocumentContext: true, needsNoteProposal: false,
          needsSegmentSearch: false, rationale: '', steps: [],
          target: { entryId: 'entry-1', kind: 'entry_meta' }
        },
        sourceByMarker: new Map([
          [1, {
            entry_id: 'entry-1', entry_title: 'old.pdf', page_idx: 0,
            quote: 'Published proceedings and author affiliations', segment_uid: 'segment-1'
          }],
          [2, {
            entry_id: 'entry-1', entry_title: 'old.pdf', page_idx: 0,
            quote: 'Reliable Agent Workflows', segment_uid: 'segment-2'
          }]
        ])
      }
    );

    expect(proposal.sources).toMatchObject([{ marker: 'S2', segmentUid: 'segment-2' }]);
  });

  it('returns a tool error observation for paper-derived metadata without target evidence', () => {
    expect(() => buildEntryMetaProposal(
      { source_markers: ['S1'], title: 'New title' },
      {
        entries: [{ description: '', id: 'entry-1', title: 'Old', updatedAt: 'v1' }],
        plan: {
          attachments: [], capabilities: [], citationPolicy: 'required', confidence: 1,
          deliverables: ['entry_meta_change_proposal'],
          entryMetaChange: { entryId: 'entry-1', fields: ['title'] },
          intent: 'entry_meta_update', missing: [], needsCurrentNote: false,
          needsDocumentContext: true, needsNoteProposal: false,
          needsSegmentSearch: false, rationale: '', steps: [],
          target: { entryId: 'entry-1', kind: 'entry_meta' }
        },
        sourceByMarker: new Map([[1, {
          entry_id: 'entry-2', entry_title: 'Other paper', page_idx: 0,
          quote: 'Unrelated evidence', segment_uid: 'segment-2'
        }]])
      }
    )).toThrow('requires a valid source marker');
  });

  it('returns a tool error observation when metadata would not change', () => {
    expect(() => buildEntryMetaProposal(
        { title: 'Old' },
        {
          entries: [{ description: '', id: 'entry-1', title: 'Old', updatedAt: 'v1' }],
          plan: {
            attachments: [], capabilities: [], citationPolicy: 'none', confidence: 1,
            deliverables: ['entry_meta_change_proposal'],
            entryMetaChange: { entryId: 'entry-1', fields: ['title'] },
            intent: 'entry_meta_update', missing: [], needsCurrentNote: false,
            needsDocumentContext: false, needsNoteProposal: false,
            needsSegmentSearch: false, rationale: '', steps: [],
            target: { entryId: 'entry-1', kind: 'entry_meta' }
          },
          sourceByMarker: new Map()
        }
      )).toThrow('identical to the current metadata');
  });
});
