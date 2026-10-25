import { expect, it } from 'vitest';
import { assistantEvidenceNavigation, assistantReplyEvidencePane } from './assistantReplyNavigation';
import { jumpForSurface } from '@/modules/reader/sourceJump';
import { initialWorkspaceSurfaceLayout, workspaceSurfaceOpenActions, workspaceSurfaceReducer, type WorkspaceSurface } from './workspaceSurface';

const reply: WorkspaceSurface = { kind: 'assistant-reply', message: {
  message_id: 'reply', role: 'assistant', content: '回答 [S1]', source_links: [], created_at: ''
} };

it.each(['left', 'right'] as const)('keeps the %s reply visible while opening and switching evidence', pane => {
  const layout = workspaceSurfaceOpenActions(initialWorkspaceSurfaceLayout, reply, pane).reduce(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);
  const destination = assistantReplyEvidencePane(layout, 'reply');
  expect(destination).toBe(pane === 'left' ? 'right' : 'left');
  const pdf: WorkspaceSurface = { kind: 'pdf', entryId: 'paper' };
  const opened = workspaceSurfaceOpenActions(layout, pdf, destination).reduce(workspaceSurfaceReducer, layout);
  expect(opened[pane]).toEqual(reply);
  expect(opened[destination!]).toEqual(pdf);
  expect(assistantReplyEvidencePane(opened, 'reply')).toBe(destination);
  const switched = workspaceSurfaceOpenActions(opened, { kind: 'pdf', entryId: 'another' }, destination).reduce(workspaceSurfaceReducer, opened);
  expect(switched[pane]).toEqual(reply);
});

it('uses ordinary navigation for chat citations and replies that are no longer visible', () => {
  expect(assistantReplyEvidencePane(initialWorkspaceSurfaceLayout)).toBeUndefined();
  expect(assistantReplyEvidencePane(initialWorkspaceSurfaceLayout, 'reply')).toBeUndefined();
});

it.each([false, true])('delivers the reply citation only to its opened PDF (split=%s)', split => {
  const layout = workspaceSurfaceOpenActions(initialWorkspaceSurfaceLayout, reply, split ? 'right' : 'left').reduce(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);
  const source = { entry_id: 'paper', entry_title: '论文', segment_uid: 'segment', page_idx: 4, quote: '原文' };
  const destination = assistantEvidenceNavigation(layout, source, 7, 'reply');
  expect(jumpForSurface(destination.jump, 'pdf:paper')).toEqual(expect.objectContaining({ segmentUid: 'segment', pageIdx: 4 }));
  expect(jumpForSurface(destination.jump, 'pdf:paper:view:other')).toBeNull();
  expect(jumpForSurface(destination.jump, 'reflow:paper')).toBeNull();
});

it('addresses the exact visible PDF copy and uses a page jump for a page-only source', () => {
  const layout = workspaceSurfaceOpenActions(initialWorkspaceSurfaceLayout, reply, 'left').reduce(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);
  const copy: WorkspaceSurface = { kind: 'pdf', entryId: 'paper', viewId: 'copy' };
  const opened = workspaceSurfaceOpenActions(layout, copy, 'right').reduce(workspaceSurfaceReducer, layout);
  const destination = assistantEvidenceNavigation(opened, { entry_id: 'paper', entry_title: '论文', segment_uid: '', page_idx: 3, quote: '' }, 8, 'reply');
  expect(destination.surface).toEqual(copy);
  expect(destination.jump).toMatchObject({ kind: 'page', pageIdx: 3, targetSurfaceKey: 'pdf:paper:view:copy' });
  expect(jumpForSurface(destination.jump, 'pdf:paper')).toBeNull();
});
